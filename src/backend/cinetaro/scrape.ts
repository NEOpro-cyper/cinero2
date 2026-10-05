import type { Stream } from "@movie-web/providers";

import { labelToLanguageCode } from "@/utils/providersShim";

import type { ServerConfig } from "./servers";
import type {
  AetherMeridianResponse,
  AetherTikiResponse,
  AtlasResponse,
  AtlasSource,
  BingrResponse,
  BingrSource,
  GenericStreamResponse,
  OpStreamResponse,
  QualitiesResponse,
  VidnestResponse,
} from "./types";

// ───────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────

type QualityKey = "1080" | "720" | "480" | "360" | "4k" | "unknown";
type StreamCaptions = Stream["captions"];

function makeId(prefix: string, idx: number): string {
  return `${prefix}-${idx}`;
}

function normalizeQuality(q?: string): QualityKey {
  if (!q) return "unknown";
  const s = String(q).toLowerCase();
  if (s.includes("4k") || s.includes("2160")) return "4k";
  if (s.includes("1080")) return "1080";
  if (s.includes("720")) return "720";
  if (s.includes("480")) return "480";
  if (s.includes("360")) return "360";
  return "unknown";
}

function normalizeCaptions(
  captions:
    | {
        url?: string;
        label?: string;
        lang?: string;
        language?: string;
        type?: string;
      }[]
    | undefined,
): StreamCaptions {
  if (!Array.isArray(captions)) return [];
  return captions
    .filter(
      (
        c,
      ): c is {
        url: string;
        label?: string;
        lang?: string;
        language?: string;
        type?: string;
      } => Boolean(c && c.url),
    )
    .map((c, i) => {
      const langRaw = c.lang || c.language || c.label || "";
      const lang =
        labelToLanguageCode(langRaw) ||
        String(langRaw || "und").slice(0, 3) ||
        "und";
      const isSrt =
        (c.type && c.type.toLowerCase().includes("srt")) ||
        c.url.toLowerCase().endsWith(".srt");
      return {
        id: `cap-${i}-${lang}`,
        url: c.url,
        language: lang,
        type: isSrt ? ("srt" as const) : ("vtt" as const),
        hasCorsRestrictions: false,
      };
    });
}

function isHlsUrl(url: string): boolean {
  const u = String(url).toLowerCase().split("?")[0];
  return u.endsWith(".m3u8") || u.includes(".m3u8");
}

function applyStreamProxy(url: string, server: ServerConfig): string {
  if (!server.streamProxy) return url;
  // Avoid double-prefixing
  if (url.startsWith(server.streamProxy)) return url;
  return server.streamProxy + url;
}

// ───────────────────────────────────────────────────────────────
// Stream builders — return properly-typed Stream union members
// ───────────────────────────────────────────────────────────────

interface StreamExtras {
  captions?: StreamCaptions;
  headers?: Record<string, string>;
}

function makeHls(id: string, url: string, extras: StreamExtras = {}): Stream {
  const captions = extras.captions ?? [];
  return {
    id,
    flags: [],
    captions,
    ...(extras.headers ? { headers: extras.headers } : {}),
    type: "hls",
    playlist: url,
  };
}

function makeFile(
  id: string,
  url: string,
  quality: QualityKey,
  extras: StreamExtras = {},
): Stream {
  const captions = extras.captions ?? [];
  return {
    id,
    flags: [],
    captions,
    ...(extras.headers ? { headers: extras.headers } : {}),
    type: "file",
    qualities: { [quality]: { type: "mp4", url } },
  };
}

/**
 * Build a single Stream from a URL, automatically choosing HLS vs file
 * based on the URL extension.
 */
function buildStream(
  id: string,
  url: string,
  opts: { quality?: QualityKey } & StreamExtras = {},
): Stream {
  if (isHlsUrl(url)) return makeHls(id, url, opts);
  return makeFile(id, url, opts.quality ?? "unknown", opts);
}

function selectBingrSource(
  sources: BingrSource[],
  preferredQuality?: string,
): BingrSource | undefined {
  if (sources.length === 0) return undefined;
  if (!preferredQuality) return sources[0];
  const q = String(preferredQuality).toLowerCase();
  const match = sources.find((s) => {
    const sq = (s.quality || "").toLowerCase();
    const sl = (s.label || s.name || "").toLowerCase();
    return sq.includes(q) || sl.includes(q);
  });
  return match || sources[0];
}

// ───────────────────────────────────────────────────────────────
// Per-responseType parsers
// Each returns a Stream[] array. Empty array means "no streams found".
// ───────────────────────────────────────────────────────────────

export function parseOpStream(
  data: OpStreamResponse,
  server: ServerConfig,
): Stream[] {
  if (!data || data.success === false || (!data.streamUrl && !data.url))
    return [];
  const url = applyStreamProxy(data.streamUrl || (data.url as string), server);
  if (!url) return [];
  return [
    buildStream(makeId("opstream", 0), url, {
      quality: normalizeQuality(server.quality),
      captions: normalizeCaptions(data.captions),
    }),
  ];
}

export function parseBingr(
  data: BingrResponse,
  server: ServerConfig,
): Stream[] {
  if (!data || !Array.isArray(data.servers)) return [];
  const out: Stream[] = [];
  let idx = 0;
  for (const srv of data.servers) {
    if (srv.status !== "ok" || !srv.sources || srv.sources.length === 0)
      continue;
    const chosen = selectBingrSource(srv.sources, server.quality);
    if (!chosen || !chosen.url) continue;
    const url = applyStreamProxy(chosen.url, server);
    const isHls = isHlsUrl(url) || (chosen.type || "").includes("mpegurl");
    out.push(
      isHls
        ? makeHls(makeId(`bingr-${srv.id}`, idx), url, {
            captions: normalizeCaptions(srv.subtitles),
            headers: chosen.headers,
          })
        : makeFile(
            makeId(`bingr-${srv.id}`, idx),
            url,
            normalizeQuality(chosen.quality || server.quality),
            {
              captions: normalizeCaptions(srv.subtitles),
              headers: chosen.headers,
            },
          ),
    );
    idx += 1;
    // Bingr returns multiple servers - we only need one good stream
    break;
  }
  return out;
}

export function parseAetherTiki(
  data: AetherTikiResponse,
  server: ServerConfig,
): Stream[] {
  if (!data || data.ok === false || !data.data) return [];
  const d = data.data;
  const captions = normalizeCaptions(d.subtitles);

  // Shape A: streams[]
  if (Array.isArray(d.streams) && d.streams.length > 0) {
    const first = d.streams[0];
    if (first && first.url) {
      const url = applyStreamProxy(first.url, server);
      return [
        buildStream(makeId("aether-tiki", 0), url, {
          quality: normalizeQuality(first.quality || server.quality),
          captions,
        }),
      ];
    }
  }
  // Shape B: stream (single URL)
  if (d.stream) {
    const url = applyStreamProxy(d.stream, server);
    return [buildStream(makeId("aether-tiki", 0), url, { captions })];
  }
  // Shape C: url (single URL)
  if (d.url) {
    const url = applyStreamProxy(d.url, server);
    return [buildStream(makeId("aether-tiki", 0), url, { captions })];
  }
  return [];
}

export function parseAetherMeridian(
  data: AetherMeridianResponse,
  server: ServerConfig,
): Stream[] {
  if (!data || data.ok === false || !data.data) return [];
  const d = data.data;
  const url =
    d.url || d.stream || (d.streams && d.streams[0] && d.streams[0].url);
  if (!url) return [];
  const finalUrl = applyStreamProxy(url, server);
  return [
    buildStream(makeId("aether-meridian", 0), finalUrl, {
      captions: normalizeCaptions(d.subtitles),
    }),
  ];
}

export function parseVidnest(
  data: VidnestResponse,
  server: ServerConfig,
): Stream[] {
  if (!data) return [];
  // streams[]
  if (Array.isArray(data.streams) && data.streams.length > 0) {
    const first = data.streams[0];
    if (first && first.url) {
      const url = applyStreamProxy(first.url, server);
      return [
        buildStream(makeId("vidnest", 0), url, {
          quality: normalizeQuality(first.quality || server.quality),
        }),
      ];
    }
  }
  // sources[]
  if (Array.isArray(data.sources) && data.sources.length > 0) {
    const first = data.sources[0];
    if (first && first.url) {
      const url = applyStreamProxy(first.url, server);
      return [
        buildStream(makeId("vidnest", 0), url, {
          quality: normalizeQuality(first.quality || server.quality),
        }),
      ];
    }
  }
  // url / stream
  const url = data.url || data.stream;
  if (url) {
    const finalUrl = applyStreamProxy(url, server);
    return [buildStream(makeId("vidnest", 0), finalUrl, {})];
  }
  return [];
}

export function parseAtlas(
  data: AtlasResponse,
  server: ServerConfig,
): Stream[] {
  if (!data || !Array.isArray(data.sources) || data.sources.length === 0)
    return [];
  const out: Stream[] = [];
  data.sources.forEach((src: AtlasSource, i: number) => {
    if (!src.url) return;
    const url = applyStreamProxy(src.url, server);
    const isHls = isHlsUrl(url) || src.type === "hls";
    out.push(
      isHls
        ? makeHls(makeId(`atlas-${i}`, i), url)
        : makeFile(
            makeId(`atlas-${i}`, i),
            url,
            normalizeQuality(src.quality || server.quality),
          ),
    );
  });
  return out;
}

export function parseGenericStream(
  data: GenericStreamResponse,
  server: ServerConfig,
): Stream[] {
  if (!data) return [];
  // sources[] takes priority
  if (Array.isArray(data.sources) && data.sources.length > 0) {
    return parseAtlas(data as unknown as AtlasResponse, server);
  }
  const url = data.stream || data.streamUrl || data.url;
  if (!url) return [];
  const finalUrl = applyStreamProxy(url, server);
  return [buildStream(makeId("stream", 0), finalUrl, {})];
}

export function parseQualities(
  data: QualitiesResponse,
  server: ServerConfig,
): Stream[] {
  if (!data) return [];
  // If qualities is a map of quality -> URL
  if (data.qualities && typeof data.qualities === "object") {
    const qualities: Partial<Record<QualityKey, { type: "mp4"; url: string }>> =
      {};
    let hlsUrl: string | null = null;
    for (const [q, u] of Object.entries(data.qualities)) {
      if (typeof u !== "string" || !u) continue;
      const url = applyStreamProxy(u, server);
      if (isHlsUrl(url)) {
        hlsUrl = url;
        break;
      }
      const nq = normalizeQuality(q);
      qualities[nq] = { type: "mp4", url };
    }
    if (hlsUrl) {
      return [makeHls(makeId("qualities", 0), hlsUrl)];
    }
    if (Object.keys(qualities).length > 0) {
      return [
        {
          id: makeId("qualities", 0),
          flags: [],
          captions: [],
          type: "file",
          qualities,
        },
      ];
    }
  }
  // Fallback to sources[]
  if (Array.isArray(data.sources) && data.sources.length > 0) {
    return parseAtlas(data as unknown as AtlasResponse, server);
  }
  // Fallback to single stream
  if (data.stream) {
    return parseGenericStream({ stream: data.stream }, server);
  }
  return [];
}

export function parseSourceString(
  data: unknown,
  server: ServerConfig,
): Stream[] {
  let url: string | undefined;
  if (typeof data === "string") {
    url = data.trim();
    // Some APIs return a JSON-quoted string
    if (url.startsWith('"') && url.endsWith('"')) {
      try {
        url = JSON.parse(url);
      } catch {
        // ignore
      }
    }
  } else if (data && typeof data === "object") {
    const d = data as {
      stream?: string;
      streamUrl?: string;
      url?: string;
      source?: string;
    };
    url = d.stream || d.streamUrl || d.url || d.source;
  }
  if (!url || typeof url !== "string") return [];
  const finalUrl = applyStreamProxy(url, server);
  return [buildStream(makeId("srcstr", 0), finalUrl, {})];
}

// ───────────────────────────────────────────────────────────────
// Dispatcher
// ───────────────────────────────────────────────────────────────

export function parseByResponseType(data: any, server: ServerConfig): Stream[] {
  if (!data) return [];
  const rt = server.responseType;
  try {
    switch (rt) {
      case "opstream":
        return parseOpStream(data as OpStreamResponse, server);
      case "bingr":
        return parseBingr(data as BingrResponse, server);
      case "aether_tiki":
        return parseAetherTiki(data as AetherTikiResponse, server);
      case "aether_meridian":
        return parseAetherMeridian(data as AetherMeridianResponse, server);
      case "vidnest":
        return parseVidnest(data as VidnestResponse, server);
      case "sources":
        return parseAtlas(data as AtlasResponse, server);
      case "streams":
        // Treat like Atlas sources[]
        return parseAtlas(data as AtlasResponse, server);
      case "stream":
      case "stream_url":
      case "streamUrl":
      case "source_object":
        return parseGenericStream(data as GenericStreamResponse, server);
      case "qualities":
        return parseQualities(data as QualitiesResponse, server);
      case "source_string":
        return parseSourceString(data, server);
      default:
        // Best-effort: try generic then atlas
        return parseGenericStream(data as GenericStreamResponse, server);
    }
  } catch (err) {
    console.error(`[cinetaro] parse error for ${server.name} (${rt}):`, err);
    return [];
  }
}
