/**
 * Per-responseType adapters.
 *
 * Each adapter takes the raw parsed JSON returned by a server and converts
 * it to a NormalizedStream that the rest of the P-Stream player can consume.
 *
 * Adapters are intentionally defensive: they probe multiple known shapes
 * for each responseType and fall back to a deep-scan for any URL-like
 * field if the documented shape isn't found. This keeps the player working
 * even when an upstream API changes its response format slightly.
 */

import type {
  NormalizedCaption,
  NormalizedFileQuality,
  NormalizedStream,
} from "./types";

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

const HLS_EXT_RE = /\.m3u8(\?|$)/i;
const MP4_EXT_RE = /\.mp4(\?|$)/i;

function isString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function looksLikeUrl(v: unknown): v is string {
  if (!isString(v)) return false;
  return /^https?:\/\//i.test(v);
}

function isHlsUrl(url: string): boolean {
  return HLS_EXT_RE.test(url) || /m3u8/i.test(url);
}

function isMp4Url(url: string): boolean {
  return MP4_EXT_RE.test(url) || /mp4/i.test(url);
}

/** Normalize "1080p", "1080", "FHD", "Full HD", etc. → "1080" */
function normalizeQuality(input: unknown): string {
  if (typeof input !== "string" && typeof input !== "number") return "unknown";
  const s = String(input).toLowerCase().trim();
  if (!s) return "unknown";
  if (/4k|2160|uhd/.test(s)) return "4k";
  if (/1080|fhd|full\s*hd/.test(s)) return "1080";
  if (/720|hd\b|hdready/.test(s)) return "720";
  if (/480|sd|vga/.test(s)) return "480";
  if (/360|nhd|low/.test(s)) return "360";
  return "unknown";
}

/**
 * Numeric rank for a quality label — higher is better.
 * Used for sorting streams by quality (descending) so we pick the
 * best available. String comparison doesn't work because "1080" <
 * "720" lexicographically.
 */
function qualityRank(input: unknown): number {
  const q = normalizeQuality(input);
  switch (q) {
    case "4k":
      return 5;
    case "1080":
      return 4;
    case "720":
      return 3;
    case "480":
      return 2;
    case "360":
      return 1;
    default:
      return 0;
  }
}

/** Pick a single best URL from an object by walking common keys. */
function findFirstUrl(obj: any): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const keys = [
    "url",
    "streamUrl",
    "stream_url",
    "link",
    "src",
    "file",
    "playlist",
    "playbackUrl",
    "manifest",
  ];
  for (const k of keys) {
    if (looksLikeUrl(obj[k])) return obj[k] as string;
  }
  return undefined;
}

/** Deep-walk an object looking for the first HLS or MP4 URL string. */
function deepFindStreamUrl(obj: any, depth = 0): string | undefined {
  if (depth > 6) return undefined;
  if (!obj) return undefined;
  if (looksLikeUrl(obj)) {
    if (isHlsUrl(obj) || isMp4Url(obj)) return obj;
    return undefined;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const hit = deepFindStreamUrl(item, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  }
  if (typeof obj === "object") {
    const direct = findFirstUrl(obj);
    if (direct && (isHlsUrl(direct) || isMp4Url(direct))) return direct;
    for (const k of Object.keys(obj)) {
      const hit = deepFindStreamUrl(obj[k], depth + 1);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** Walk an object/array and harvest every {url, quality, headers, language, type} blob. */
interface RawSource {
  url?: string;
  quality?: string;
  language?: string;
  type?: string;
  headers?: Record<string, string>;
  name?: string;
  label?: string;
}
function collectRawSources(
  obj: any,
  out: RawSource[] = [],
  depth = 0,
): RawSource[] {
  if (depth > 8 || !obj) return out;
  if (Array.isArray(obj)) {
    for (const item of obj) collectRawSources(item, out, depth + 1);
    return out;
  }
  if (typeof obj === "object") {
    const url = findFirstUrl(obj);
    if (url) {
      out.push({
        url,
        quality: obj.quality ?? obj.resolution ?? obj.height,
        language: obj.language ?? obj.lang,
        type: obj.type ?? obj.mimeType ?? obj.mime,
        headers:
          obj.headers && typeof obj.headers === "object"
            ? obj.headers
            : undefined,
        name: obj.name ?? obj.label ?? obj.title,
        label: obj.label ?? obj.name ?? obj.title,
      });
    }
    for (const k of Object.keys(obj)) {
      // avoid recursing into primitives / huge strings
      if (typeof obj[k] === "object") collectRawSources(obj[k], out, depth + 1);
    }
  }
  return out;
}

function collectRawCaptions(
  obj: any,
  out: NormalizedCaption[] = [],
  depth = 0,
): NormalizedCaption[] {
  if (depth > 8 || !obj) return out;
  if (Array.isArray(obj)) {
    for (const item of obj) collectRawCaptions(item, out, depth + 1);
    return out;
  }
  if (typeof obj === "object") {
    const url = looksLikeUrl(obj.url)
      ? obj.url
      : looksLikeUrl(obj.src)
        ? obj.src
        : looksLikeUrl(obj.link)
          ? obj.link
          : undefined;
    if (url && /\.(vtt|srt|ass|ssa|sub)(\?|$)/i.test(url)) {
      out.push({
        id: `cap-${out.length}-${(obj.language ?? obj.lang ?? "und") as string}`,
        language: String(obj.language ?? obj.lang ?? "und"),
        url,
        type: obj.type,
        display: obj.label ?? obj.name ?? obj.language,
      });
    } else if (
      url &&
      /subtitle|caption|sub/i.test(JSON.stringify(obj).slice(0, 200))
    ) {
      out.push({
        id: `cap-${out.length}-${(obj.language ?? obj.lang ?? "und") as string}`,
        language: String(obj.language ?? obj.lang ?? "und"),
        url,
        type: obj.type,
        display: obj.label ?? obj.name ?? obj.language,
      });
    }
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === "object")
        collectRawCaptions(obj[k], out, depth + 1);
    }
  }
  return out;
}

function hlsFromUrl(
  url: string,
  opts: {
    headers?: Record<string, string>;
    captions?: NormalizedCaption[];
    label?: string;
  } = {},
): NormalizedStream {
  return {
    type: "hls",
    url,
    headers: opts.headers,
    preferredHeaders: opts.headers,
    captions: opts.captions ?? [],
    label: opts.label,
  };
}

function fileFromQualities(
  qs: NormalizedFileQuality[],
  opts: {
    headers?: Record<string, string>;
    captions?: NormalizedCaption[];
    label?: string;
  } = {},
): NormalizedStream {
  return {
    type: "file",
    qualities: qs,
    headers: opts.headers,
    preferredHeaders: opts.headers,
    captions: opts.captions ?? [],
    label: opts.label,
  };
}

/** Build a NormalizedStream from a flat list of RawSources (multi-quality aware). */
function fromRawSources(
  raw: RawSource[],
  captions: NormalizedCaption[],
): NormalizedStream | undefined {
  if (raw.length === 0) return undefined;

  // Group by stream type (HLS vs MP4). Prefer HLS if any HLS exists.
  const hlsSources = raw.filter((r) => r.url && isHlsUrl(r.url));
  const mp4Sources = raw.filter((r) => r.url && isMp4Url(r.url));
  const otherSources = raw.filter(
    (r) => r.url && !isHlsUrl(r.url) && !isMp4Url(r.url),
  );

  if (hlsSources.length > 0) {
    // Pick the highest-quality HLS variant.
    // Use qualityRank (numeric) — string localeCompare is broken for
    // numeric qualities ("1080" < "720" lexicographically).
    const sorted = [...hlsSources].sort(
      (a, b) => qualityRank(b.quality) - qualityRank(a.quality),
    );
    const best = sorted[0];
    return hlsFromUrl(best.url!, {
      headers: best.headers,
      captions,
      label: best.label ?? best.name,
    });
  }

  if (mp4Sources.length > 0) {
    const qs: NormalizedFileQuality[] = mp4Sources.map((r) => ({
      quality: normalizeQuality(r.quality),
      url: r.url!,
      type: "mp4" as const,
    }));
    // Dedup by quality, keeping the first.
    const seen = new Set<string>();
    const deduped = qs.filter((q) => {
      if (seen.has(q.quality)) return false;
      seen.add(q.quality);
      return true;
    });
    return fileFromQualities(deduped, { captions });
  }

  // Unknown stream types — treat as HLS if URL looks like a manifest, else bail.
  if (otherSources.length > 0 && otherSources[0].url) {
    return hlsFromUrl(otherSources[0].url, { captions });
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/*  per-responseType adapters                                         */
/* ------------------------------------------------------------------ */

/**
 * `opstream` — OpStream API v2 (Armor)
 * Response shape (probed):
 *   {
 *     success: true,
 *     type: "movie"|"tv",
 *     tmdbId, title, server, kind: "hls",
 *     streamUrl: "https://...",
 *     captions: [{ url, label }],
 *     availableServers: [...]
 *   }
 */
function adaptOpstream(json: any): NormalizedStream | undefined {
  if (!json || json.success === false) return undefined;
  const url = looksLikeUrl(json.streamUrl) ? json.streamUrl : undefined;
  if (!url) return undefined;
  const captions: NormalizedCaption[] = Array.isArray(json.captions)
    ? json.captions
        .map((c: any, i: number) => ({
          id: `opstream-cap-${i}`,
          language: String(c.label ?? c.language ?? "und"),
          url: c.url,
          display: c.label,
        }))
        .filter((c: NormalizedCaption) => looksLikeUrl(c.url))
    : [];
  return hlsFromUrl(url, { captions, label: json.title });
}

/**
 * `bingr` — Bingr Proxy API (Kuro)
 * Response shape (probed):
 *   {
 *     type, tmdbId, title, year, poster,
 *     servers: [{
 *       no, id, name, status, httpStatus,
 *       sources: [{
 *         url, quality, language, type:"application/x-mpegurl",
 *         label, name, headers:{Referer:...}
 *       }, ...],
 *       subtitles: [{ url, label, lang }]
 *     }, ...]
 *   }
 */
function adaptBingr(json: any): NormalizedStream | undefined {
  if (!json || !Array.isArray(json.servers)) return undefined;
  const raw: RawSource[] = [];
  const captions: NormalizedCaption[] = [];
  for (const server of json.servers) {
    if (server && Array.isArray(server.sources)) {
      for (const s of server.sources) {
        if (!looksLikeUrl(s?.url)) continue;
        raw.push({
          url: s.url,
          quality: s.quality,
          language: s.language,
          type: s.type,
          headers:
            s.headers && typeof s.headers === "object" ? s.headers : undefined,
          name: s.name ?? s.label,
          label: s.label ?? s.name,
        });
      }
    }
    if (server && Array.isArray(server.subtitles)) {
      for (const sub of server.subtitles) {
        if (!looksLikeUrl(sub?.url)) continue;
        captions.push({
          id: `bingr-cap-${captions.length}`,
          language: String(sub.lang ?? sub.label ?? sub.language ?? "und"),
          url: sub.url,
          display: sub.label ?? sub.language,
        });
      }
    }
  }
  return fromRawSources(raw, captions);
}

/**
 * `aether_tiki` — Aether API server=4 (Tiki)
 * Response shape (probed):
 *   {
 *     ok: true, server: 4, serverName, source,
 *     data: {
 *       success, title, type, tmdb_id, season, episode,
 *       streams: [{ name, url, type:"hls" }]
 *     }
 *   }
 */
function adaptAetherTiki(json: any): NormalizedStream | undefined {
  const data = json?.data ?? json;
  if (!data) return undefined;
  const streams = Array.isArray(data.streams) ? data.streams : [];
  if (streams.length === 0) return undefined;
  const raw: RawSource[] = streams
    .filter((s: any) => looksLikeUrl(s?.url))
    .map((s: any) => ({
      url: s.url,
      quality: s.quality,
      type: s.type,
      name: s.name,
      label: s.name,
    }));
  return fromRawSources(raw, []);
}

/**
 * `aether_meridian` — Aether API server=2 (Meridian)
 * Response shape (probed):
 *   {
 *     ok: true, server: 2, serverName:"meridian", source,
 *     data: {
 *       title,
 *       url: "https://...",  // HLS m3u8 (already proxied)
 *       subtitles: [{ language, url, type:"vtt" }]
 *     }
 *   }
 */
function adaptAetherMeridian(json: any): NormalizedStream | undefined {
  const data = json?.data ?? json;
  if (!data) return undefined;
  const url = looksLikeUrl(data.url) ? data.url : findFirstUrl(data);
  if (!url) return undefined;
  const captions: NormalizedCaption[] = Array.isArray(data.subtitles)
    ? data.subtitles
        .filter((s: any) => looksLikeUrl(s?.url))
        .map((s: any, i: number) => ({
          id: `meridian-cap-${i}`,
          language: String(s.language ?? "und"),
          url: s.url,
          type: s.type,
          display: s.language,
        }))
    : [];
  return hlsFromUrl(url, { captions, label: data.title });
}

/**
 * `vidnest` — Vidnest API (Nest)
 * Probed response was an error: {"error":"Upstream error","status":402,...}
 * Best-guess success shape (based on similar APIs):
 *   {
 *     sources: [{ url, quality, type:"mp4"|"hls", label }],
 *     // OR
 *     streams: [{ url, name, type:"hls" }]
 *   }
 * Adapter falls back to deep-scan if shape doesn't match.
 */
function adaptVidnest(json: any): NormalizedStream | undefined {
  if (json?.error) return undefined;
  const raw = collectRawSources(json);
  const captions = collectRawCaptions(json);
  return fromRawSources(raw, captions);
}

/**
 * `sources` — VidRock / Atlas
 * Response shape (probed):
 *   {
 *     tmdbId, type:"movie", totalServers, availableSources,
 *     sources: [{ name, url, language, flag, type:"hls" }]
 *   }
 */
function adaptSources(json: any): NormalizedStream | undefined {
  if (json?.error) return undefined;
  const list = Array.isArray(json?.sources)
    ? json.sources
    : Array.isArray(json)
      ? json
      : [];
  const raw: RawSource[] = list
    .filter((s: any) => looksLikeUrl(s?.url))
    .map((s: any) => ({
      url: s.url,
      quality: s.quality,
      type: s.type,
      name: s.name,
      label: s.name ?? s.label,
    }));
  return fromRawSources(raw, []);
}

/**
 * `qualities` — CinetaroCDN
 * Host didn't resolve from sandbox (likely geo-locked). Expected shape:
 *   {
 *     qualities: { "1080p": "url", "720p": "url", "480p": "url" }
 *     // OR
 *     sources: [{ quality:"1080p", url:"..." }]
 *   }
 * Adapter handles both, falls back to deep-scan.
 */
function adaptQualities(json: any): NormalizedStream | undefined {
  if (json?.error) return undefined;
  const qs: NormalizedFileQuality[] = [];

  // Shape 1: { qualities: { "1080p": "url" } }
  if (
    json?.qualities &&
    typeof json.qualities === "object" &&
    !Array.isArray(json.qualities)
  ) {
    for (const [q, url] of Object.entries(json.qualities)) {
      if (looksLikeUrl(url)) {
        qs.push({
          quality: normalizeQuality(q),
          url: url as string,
          type: "mp4",
        });
      }
    }
  }
  // Shape 2: { sources: [{ quality, url }] }
  if (qs.length === 0 && Array.isArray(json?.sources)) {
    for (const s of json.sources) {
      if (looksLikeUrl(s?.url)) {
        qs.push({
          quality: normalizeQuality(s.quality),
          url: s.url,
          type: "mp4",
        });
      }
    }
  }
  // Shape 3: { url: "..." } (HLS single stream)
  if (qs.length === 0) {
    const raw = collectRawSources(json);
    return fromRawSources(raw, collectRawCaptions(json));
  }
  return fileFromQualities(qs, { captions: collectRawCaptions(json) });
}

/**
 * `stream` — Single direct stream URL.
 * Expected: { stream: "https://...m3u8" }  OR  { url: "..." }  OR  plain string
 */
function adaptStream(json: any): NormalizedStream | undefined {
  const url = looksLikeUrl(json?.stream)
    ? json.stream
    : looksLikeUrl(json?.url)
      ? json.url
      : looksLikeUrl(json?.streamUrl)
        ? json.streamUrl
        : looksLikeUrl(json)
          ? json
          : deepFindStreamUrl(json);
  if (!url) return undefined;
  if (isHlsUrl(url))
    return hlsFromUrl(url, { captions: collectRawCaptions(json) });
  if (isMp4Url(url)) {
    return fileFromQualities([{ quality: "unknown", url, type: "mp4" }], {
      captions: collectRawCaptions(json),
    });
  }
  return hlsFromUrl(url, { captions: collectRawCaptions(json) });
}

/**
 * `streams` — Array of stream URLs.
 * Expected: { streams: ["url1", "url2"] }  OR  [{ url:"..." }, ...]
 */
function adaptStreams(json: any): NormalizedStream | undefined {
  const list = Array.isArray(json?.streams)
    ? json.streams
    : Array.isArray(json)
      ? json
      : [];
  const raw: RawSource[] = list
    .map((s: any) =>
      looksLikeUrl(s)
        ? { url: s }
        : { url: s?.url, quality: s?.quality, name: s?.name, label: s?.label },
    )
    .filter((r: RawSource) => looksLikeUrl(r.url));
  return fromRawSources(raw, collectRawCaptions(json));
}

/**
 * `stream_url` / `streamUrl` — Object containing a streamUrl field.
 */
function adaptStreamUrl(json: any): NormalizedStream | undefined {
  const url = looksLikeUrl(json?.streamUrl)
    ? json.streamUrl
    : looksLikeUrl(json?.stream_url)
      ? json.stream_url
      : looksLikeUrl(json?.url)
        ? json.url
        : deepFindStreamUrl(json);
  if (!url) return undefined;
  if (isHlsUrl(url))
    return hlsFromUrl(url, { captions: collectRawCaptions(json) });
  if (isMp4Url(url)) {
    return fileFromQualities([{ quality: "unknown", url, type: "mp4" }], {
      captions: collectRawCaptions(json),
    });
  }
  return hlsFromUrl(url, { captions: collectRawCaptions(json) });
}

/**
 * `source_string` — Plain text URL string (3rParty).
 */
function adaptSourceString(text: unknown): NormalizedStream | undefined {
  if (looksLikeUrl(text)) {
    if (isHlsUrl(text)) return hlsFromUrl(text);
    if (isMp4Url(text))
      return fileFromQualities([
        { quality: "unknown", url: text, type: "mp4" },
      ]);
    return hlsFromUrl(text);
  }
  return undefined;
}

/**
 * `source_object` — Object with source data (Pacific/Orion/Nova).
 * Expected: { source: "https://..." }  OR  { url: "..." }
 */
function adaptSourceObject(json: any): NormalizedStream | undefined {
  const url = looksLikeUrl(json?.source)
    ? json.source
    : deepFindStreamUrl(json);
  if (!url) return undefined;
  if (isHlsUrl(url))
    return hlsFromUrl(url, { captions: collectRawCaptions(json) });
  if (isMp4Url(url)) {
    return fileFromQualities([{ quality: "unknown", url, type: "mp4" }], {
      captions: collectRawCaptions(json),
    });
  }
  return hlsFromUrl(url, { captions: collectRawCaptions(json) });
}

/**
 * `miroru` — Miroru Proxy API (anime streaming).
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: {
 *       malId, episode, provider, category,
 *       streams: [{
 *         url:       "https://vault-09.uwucdn.top/.../uwu.m3u8",   // direct
 *         proxyUrl:  "https://...workers.dev/https://s1.piltover.li/.../pl.m3u8",
 *         type:      "hls" | "embed",
 *         quality:   "1080p" | "720p" | "360p" | ...,
 *         resolution:{ width, height },
 *         codec:     "h264",
 *         fansub:    "Arid",
 *         referer:   "https://kwik.cx/",
 *         isActive:  true | false
 *       }, ...],
 *       streamUrl: "https://...workers.dev/..."  // top-level preferred URL
 *     }
 *   }
 *
 * Selection rule (per user request):
 *   Pick the stream URL that contains "workers.dev" in it. The Cloudflare
 *   Worker proxy URL is preferred because it:
 *     1. Handles CORS in the browser (no proxy needed)
 *     2. Is already a Cloudflare-cached proxy for the underlying m3u8
 *     3. Doesn't leak the user's IP to the upstream CDN
 *
 * Order of preference:
 *   1. The HLS stream whose proxyUrl contains "workers.dev" (highest quality)
 *   2. The top-level data.streamUrl if it contains "workers.dev"
 *   3. Fall back to the highest-quality HLS stream with any URL
 *   4. Fall back to deep scan
 */
function adaptMiroru(json: any): NormalizedStream | undefined {
  if (!json || json.success === false) return undefined;
  const data = json.data ?? json;
  if (!data) return undefined;

  const streams: any[] = Array.isArray(data.streams) ? data.streams : [];

  // Helper: extract the URL with "workers.dev" from a stream entry.
  // Miroru returns BOTH a direct `url` (e.g. uwucdn.top) and a
  // `proxyUrl` (Cloudflare Worker proxy). We prefer the worker URL
  // when present, otherwise fall back to the direct URL.
  const pickWorkerUrl = (s: any): string | undefined => {
    if (!s) return undefined;
    // Prefer proxyUrl if it contains workers.dev
    if (typeof s.proxyUrl === "string" && /workers\.dev/i.test(s.proxyUrl)) {
      return s.proxyUrl;
    }
    // Otherwise check the direct url
    if (typeof s.url === "string" && /workers\.dev/i.test(s.url)) {
      return s.url;
    }
    // If neither contains workers.dev, prefer proxyUrl (still a proxy)
    if (typeof s.proxyUrl === "string" && looksLikeUrl(s.proxyUrl)) {
      return s.proxyUrl;
    }
    // Last resort: direct url
    if (typeof s.url === "string" && looksLikeUrl(s.url)) {
      return s.url;
    }
    return undefined;
  };

  // 1. Find HLS streams that have a workers.dev URL, sorted by quality desc.
  // Use qualityRank (numeric) — string localeCompare would put "720"
  // above "1080" because "7" > "1" lexicographically.
  const hlsWithWorkers = streams
    .filter((s) => s?.type === "hls")
    .map((s) => ({ stream: s, url: pickWorkerUrl(s) }))
    .filter((x) => x.url && /workers\.dev/i.test(x.url))
    .sort(
      (a, b) => qualityRank(b.stream.quality) - qualityRank(a.stream.quality),
    );

  if (hlsWithWorkers.length > 0) {
    const best = hlsWithWorkers[0];
    const headers: Record<string, string> = {};
    if (best.stream.referer) headers.Referer = best.stream.referer;
    return hlsFromUrl(best.url!, {
      headers: Object.keys(headers).length ? headers : undefined,
      captions: [],
      label: `Miroru ${best.stream.quality ?? "best"}`,
    });
  }

  // 2. Top-level streamUrl field if it contains workers.dev
  if (
    typeof data.streamUrl === "string" &&
    /workers\.dev/i.test(data.streamUrl) &&
    looksLikeUrl(data.streamUrl)
  ) {
    return hlsFromUrl(data.streamUrl, {
      captions: [],
      label: "Miroru (streamUrl)",
    });
  }

  // 3. Fall back to highest-quality HLS stream with any usable URL
  const anyHls = streams
    .filter((s) => s?.type === "hls")
    .map((s) => ({ stream: s, url: pickWorkerUrl(s) }))
    .filter((x) => x.url)
    .sort(
      (a, b) => qualityRank(b.stream.quality) - qualityRank(a.stream.quality),
    );
  if (anyHls.length > 0) {
    const best = anyHls[0];
    const headers: Record<string, string> = {};
    if (best.stream.referer) headers.Referer = best.stream.referer;
    return hlsFromUrl(best.url!, {
      headers: Object.keys(headers).length ? headers : undefined,
      captions: [],
      label: `Miroru ${best.stream.quality ?? "best"}`,
    });
  }

  // 4. Last resort: deep scan
  return fromRawSources(collectRawSources(data), collectRawCaptions(data));
}

/**
 * `url` — Plain URL servers (Hable/Vidrift, Popins/OpStream).
 *
 * Response shape (JSON object with a single URL field):
 *   { "url": "https://media.vidrift.in/movie_550/vod.m3u8" }
 * ...or a bare URL string:
 *   "https://media.vidrift.in/movie_550/vod.m3u8"
 *
 * The URL may be HLS (m3u8) or MP4 — detected by extension. Non-URL
 * fields (poster, subtitles, etc.) are scanned for captions defensively.
 */
function adaptUrl(json: unknown): NormalizedStream | undefined {
  // Bare string body — the URL itself.
  if (isString(json) && looksLikeUrl(json)) {
    const url = json;
    if (isMp4Url(url)) {
      return fileFromQualities([{ quality: "unknown", url, type: "mp4" }], {
        label: "URL",
      });
    }
    return hlsFromUrl(url, { label: "URL" });
  }

  if (!json || typeof json !== "object") return undefined;
  const data = json as Record<string, any>;

  // Probe the common URL field names, then deep-scan as fallback.
  const url =
    (looksLikeUrl(data.url) && data.url) ||
    (looksLikeUrl(data.stream_url) && data.stream_url) ||
    (looksLikeUrl(data.streamUrl) && data.streamUrl) ||
    (looksLikeUrl(data.link) && data.link) ||
    deepFindStreamUrl(data);

  if (!url) return undefined;

  const captions = collectRawCaptions(data);
  if (isMp4Url(url)) {
    return fileFromQualities([{ quality: "unknown", url, type: "mp4" }], {
      captions,
      label: "URL",
    });
  }
  return hlsFromUrl(url, { captions, label: "URL" });
}

/**
 * `hable` — Hable/Vidrift variant of the plain-URL shape.
 * Currently identical to `url`; kept as a separate responseType so the
 * server config can distinguish them if the upstream diverges.
 */
function adaptHable(json: unknown): NormalizedStream | undefined {
  return adaptUrl(json);
}

/**
 * `lordflix` — Lordflix API.
 *
 * Response shape:
 *   {
 *     "success": true,
 *     "kind": "movie",
 *     "tmdbId": "550",
 *     "server": "Nebula",
 *     "4k": false,
 *     "stream": [{
 *       "type": "hls",
 *       "id": "primary",
 *       "playlist": "https://proxyjoy.../master.m3u8",
 *       "captions": []
 *     }],
 *     "playlist": "https://proxyjoy.../master.m3u8",
 *     "captions": []
 *   }
 *
 * Selection: prefer the first `stream[]` entry with a usable playlist
 * (hls → HLS stream, mp4/file → file stream); fall back to the
 * top-level `playlist` / `url` fields; finally deep-scan.
 */
function adaptLordflix(json: any): NormalizedStream | undefined {
  if (!json || typeof json !== "object" || json.success === false) {
    return undefined;
  }
  const data = json;

  const captionsFor = (arr: any): NormalizedCaption[] =>
    Array.isArray(arr) ? collectRawCaptions(arr) : [];

  // 1. stream[] entries
  const streams: any[] = Array.isArray(data.stream) ? data.stream : [];
  for (const s of streams) {
    if (!s) continue;
    const url =
      (looksLikeUrl(s.playlist) && s.playlist) ||
      (looksLikeUrl(s.url) && s.url) ||
      (looksLikeUrl(s.link) && s.link) ||
      undefined;
    if (!url) continue;
    const captions = captionsFor(s.captions);
    const type = String(s.type ?? "").toLowerCase();
    if (type === "file" || isMp4Url(url)) {
      return fileFromQualities(
        [{ quality: normalizeQuality(s.quality), url, type: "mp4" }],
        { captions, label: `Lordflix · ${data.server ?? s.id ?? "stream"}` },
      );
    }
    return hlsFromUrl(url, {
      captions,
      label: `Lordflix · ${data.server ?? s.id ?? "stream"}`,
    });
  }

  // 2. Top-level playlist / url fields
  const topLevel =
    (looksLikeUrl(data.playlist) && data.playlist) ||
    (looksLikeUrl(data.url) && data.url) ||
    undefined;
  // Miami-style responses carry subtitles under `subtitles` (older
  // lordflix hosts use `captions`) — merge both, dedupe by URL.
  const topLevelCaptions: NormalizedCaption[] = [];
  {
    const seen = new Set<string>();
    for (const c of [
      ...captionsFor(data.captions),
      ...captionsFor(data.subtitles),
    ]) {
      if (seen.has(c.url)) continue;
      seen.add(c.url);
      topLevelCaptions.push(c);
    }
  }
  if (topLevel) {
    if (isMp4Url(topLevel)) {
      return fileFromQualities(
        [{ quality: "unknown", url: topLevel, type: "mp4" }],
        { captions: topLevelCaptions, label: "Lordflix" },
      );
    }
    return hlsFromUrl(topLevel, {
      captions: topLevelCaptions,
      label: "Lordflix",
    });
  }

  // 2.5 Per-quality sources[] (Miami: {sources:[{quality:"1080p",
  //     url:"...index-s1080p-v1-a1.m3u8"}, ...]} — only reached when the
  //     adaptive `playlist` field is absent).
  const srcArr: any[] = Array.isArray(data.sources) ? data.sources : [];
  if (srcArr.length > 0) {
    const raw: RawSource[] = srcArr
      .filter((s: any) => s && looksLikeUrl(s.url))
      .map((s: any) => ({
        url: s.url,
        quality: s.quality ?? s.label,
        label: s.quality,
      }));
    const stream = fromRawSources(raw, topLevelCaptions);
    if (stream) return stream;
  }

  // 3. Deep scan
  return fromRawSources(collectRawSources(data), collectRawCaptions(data));
}

/**
 * `zoko` — Zoko anime streaming API (MAL-based).
 *
 * Response shape:
 *   {
 *     "ok": true,
 *     "input": { "source": "mal", "type": "sub", "id": "21", "episode": "4" },
 *     "stream_url": "https://...workers.dev/https://hls2.../master.m3u8",
 *     "poster": "",
 *     "subtitles": [{ "lang": "en", "label": "English", "default": true,
 *                    "src": "https://...vtt" }],
 *     "download_url": "https://zokoanime.video/download/mal/21/4/sub",
 *     "skip": { "intro": { "start": 0, "end": 111 },
 *               "outro": { "start": 1373, "end": 1447 } }
 *   }
 *
 * stream_url is an HLS master playlist (already CORS-proxied through a
 * Cloudflare worker). Subtitles are VTT URLs — mapped to captions with
 * hasCorsRestrictions (the fetcher re-applies the global CORS proxy).
 */
function adaptZoko(json: any): NormalizedStream | undefined {
  if (!json || typeof json !== "object" || json.ok === false) return undefined;
  const data = json;

  const url =
    (looksLikeUrl(data.stream_url) && data.stream_url) ||
    (looksLikeUrl(data.streamUrl) && data.streamUrl) ||
    (looksLikeUrl(data.url) && data.url) ||
    undefined;
  if (!url) return undefined;

  const captions: NormalizedCaption[] = Array.isArray(data.subtitles)
    ? data.subtitles
        .filter((s: any) => s && looksLikeUrl(s.src))
        .map((s: any, i: number) => ({
          id: `zoko-cap-${i}`,
          language: String(s.lang ?? s.language ?? "en"),
          url: s.src,
          display: s.label ?? s.lang ?? "Subtitles",
          hasCorsRestrictions: false,
          // zoko flags the intended track with `default: true` — keep it
          // so the player can auto-select the right subtitle.
          isDefault: !!(s.default ?? s.isDefault),
        }))
    : [];

  return hlsFromUrl(url, { captions, label: "Zoko" });
}

/**
 * `anivexa` — Anivexa anime streaming API (MAL-based, Anikoto sources).
 *
 * Response shape (probed live with MAL id 21 / One Piece):
 *   {
 *     "anilistId": 21,
 *     "malId": 21,
 *     "episode": 1,
 *     "audio": "sub" | "dub",
 *     "streams": [
 *       {
 *         "url": "https://<worker>.workers.dev/https://.../master.m3u8?token=...",
 *         "type": "hls" | "embed",
 *         "server": "HD-1" | "Vidstream-2" | ...,
 *         "embedUrl": "https://megaplay.buzz/stream/...",
 *         "referer": "https://megaplay.buzz/",
 *         "subtitles": [{ "url": "...vtt", "label": "English",
 *                         "srclang": "en", "default": true,
 *                         "source": "HD-1" }],
 *         "priority": 5,
 *         "isActive": true,
 *         "variant": "modern",
 *         "intro": { "start": 31, "end": 111 },
 *         "outro": { "start": 1376, "end": 1447 }
 *       }, ...
 *     ],
 *     "subtitles": [ ...same shape, top-level aggregate... ],
 *     "downloads": ...,
 *     "headers": { "User-Agent": "...", "Referer": "https://megaplay.buzz/" }
 *   }
 *
 * Selection rule:
 *   1. Only HLS streams are playable (type "embed" entries are iframe
 *      pages — skip them).
 *   2. Prefer the entry flagged `isActive: true`, then highest
 *      `priority` (HD-1 has priority 5).
 *   3. Stream + subtitle URLs are already CORS-proxied through the
 *      upstream's Cloudflare worker (Access-Control-Allow-Origin: *),
 *      so captions get hasCorsRestrictions: false like Zoko.
 */
function adaptAnivexa(json: any): NormalizedStream | undefined {
  if (!json || typeof json !== "object" || json.ok === false) return undefined;

  const toCaptions = (list: any): NormalizedCaption[] =>
    Array.isArray(list)
      ? list
          .filter((s: any) => s && looksLikeUrl(s.url))
          .map((s: any, i: number) => ({
            id: `anivexa-cap-${i}`,
            language: String(s.srclang ?? s.lang ?? s.language ?? "en"),
            url: s.url,
            display: s.label ?? s.srclang ?? "Subtitles",
            hasCorsRestrictions: false,
            // anivexa flags the intended track with `default: true` — keep
            // it so the player can auto-select the right subtitle.
            isDefault: !!(s.default ?? s.isDefault),
          }))
      : [];

  const streams: any[] = Array.isArray(json.streams) ? json.streams : [];
  const usable = streams
    .filter((s) => s && s.type === "hls" && looksLikeUrl(s.url))
    .sort(
      (a, b) =>
        Number(Boolean(b.isActive)) - Number(Boolean(a.isActive)) ||
        (Number(b.priority) || 0) - (Number(a.priority) || 0),
    );

  const pick = usable[0];
  if (pick) {
    // Prefer the picked stream's own subtitle list; fall back to the
    // top-level aggregate subtitles.
    const captions =
      toCaptions(pick.subtitles).length > 0
        ? toCaptions(pick.subtitles)
        : toCaptions(json.subtitles);
    return hlsFromUrl(pick.url, {
      captions,
      label: `Anivexa · ${pick.server ?? json.audio ?? "HD"}`,
    });
  }

  // No HLS entry found — deep-scan fallback (same as other adapters).
  return fromRawSources(collectRawSources(json), collectRawCaptions(json));
}

/* ------------------------------------------------------------------ */
/*  vidfast / xpass / vidora adapters                                  */
/* ------------------------------------------------------------------ */

/**
 * `vidfast` — Vidfast stream API (Meriton ?server=1, Slaze ?server=2)
 * Service root advertises:
 *   GET /api/movie/{tmdbOrImdbId}[?server=1|name][&worker=1]
 *   GET /api/tv/{tmdbOrImdbId}/{season}/{episode}[?server=1|name][&worker=1]
 *
 * CONFIRMED success shape (live sample, identical for Meriton & Slaze):
 *   { success: true, type: "movie", id, title, poster, backdrop,
 *     selectedBy, server: { index, name: "vBlaze", ... },
 *     originalUrl: "https://moon.zenoak.top/.../master.m3u8",      (raw host)
 *     url: "https://<cors-worker>/https://moon.zenoak.top/.../master.m3u8",
 *     worker: true, stream: { url: <raw host>, ... }, cached, ... }
 * → prefer the worker-wrapped `url` (CORS-open) over `originalUrl` /
 *   `stream.url` (raw upstream host, likely CORS-restricted).
 *
 * Error envelope (upstream dec/enc stage down):
 *   { success: false, error: "enc-dec stage 2 failed: ..." }
 */
function adaptVidfast(json: any): NormalizedStream | undefined {
  if (!json || typeof json !== "object") return undefined;
  if (json.success === false || json.error) return undefined;

  const serverName = json.server?.name ? ` · ${json.server.name}` : "";

  // 1) Single-URL shapes — worker-wrapped `url` first, raw-host URLs after.
  const single = [
    json.url,
    json.streamUrl,
    json.stream_url,
    json.originalUrl,
    json.stream?.url,
    json.link,
    json.source,
    json.data?.url,
    json.data?.streamUrl,
  ].find(looksLikeUrl);
  if (single) {
    return hlsFromUrl(single, { label: `Vidfast${serverName}` });
  }

  // 2) Multi-source arrays (strings or objects)
  for (const key of ["sources", "streams", "qualities", "data"]) {
    const arr = json[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const raw: RawSource[] = arr
      .map((entry: any) => {
        if (typeof entry === "string" && looksLikeUrl(entry)) {
          return { url: entry } as RawSource;
        }
        if (entry && typeof entry === "object") {
          const url = [entry.url, entry.file, entry.link, entry.source].find(
            looksLikeUrl,
          );
          if (!url) return undefined;
          return {
            url,
            quality: entry.quality ?? entry.label ?? entry.resolution,
            language: entry.language ?? entry.lang,
            headers:
              entry.headers && typeof entry.headers === "object"
                ? entry.headers
                : undefined,
            label: entry.label ?? entry.name,
          } as RawSource;
        }
        return undefined;
      })
      .filter((r: RawSource | undefined): r is RawSource => !!r);
    const stream = fromRawSources(raw, collectRawCaptions(json));
    if (stream) return stream;
  }

  // 3) Deep-scan fallback (same as other adapters).
  return fromRawSources(collectRawSources(json), collectRawCaptions(json));
}

/**
 * `xpass` — Xpass API (Aruko). TWO-STEP flow, resolved in fetcher.ts:
 *
 *   Step 1 (this response): GET /api/movie/{id}?server=1&worker=1
 *     { mode: "single", tmdb_id, positionKey, selectedServer: "TIK 1",
 *       responseTimeMs, servers: [{ name: "TIK 1",
 *         url: "https://play.xpass.top/mdata/<hash>/1/playlist.json" }, ...] }
 *
 *   Step 2 (fetched by fetcher.ts via /api/ext/xpassplay/*, which keeps
 *   the browser's User-Agent — enough to pass the Cloudflare check):
 *     { playlist: [{ sources: [{ file: "...master.m3u8", type: "hls",
 *         label: "TIK 2", id: "..." }] }], safarihlsjs: true }
 *
 * fetcher.ts merges step 2 into the step-1 body as `playlists:
 * [{ server, data }]` before dispatching here.
 */
function adaptXpass(json: any): NormalizedStream | undefined {
  if (!json || typeof json !== "object") return undefined;
  const playlists: any[] = Array.isArray(json.playlists) ? json.playlists : [];

  for (const pl of playlists) {
    const data = pl?.data;
    const groups = Array.isArray(data?.playlist) ? data.playlist : [];
    for (const group of groups) {
      const sources = Array.isArray(group?.sources) ? group.sources : [];
      const pick = sources.find(
        (s: any) => s && looksLikeUrl(s.file) && (isHlsUrl(s.file) || isMp4Url(s.file)),
      );
      if (pick) {
        const label = [pl.server, pick.label].filter(Boolean).join(" · ");
        return hlsFromUrl(pick.file, { label: label || "Xpass" });
      }
    }
  }
  // NOTE: intentionally NO deep-scan fallback here — the only URLs in the
  // step-1 body are playlist.json manifests, which are not playable
  // streams. Returning undefined lets the player fail over to the next
  // server instead of feeding the player a JSON manifest.
  return undefined;
}

/**
 * `vidora` — Vidora API (Kyro)
 * Success shape (probed):
 *   { result: true, type: "movie"|"tv", title, tmdb_id, imdb_id, year,
 *     view_type, view_id,
 *     sources: [{ file_code, url: "https://<cors-worker>/https://.../master.m3u8?...",
 *                 source: "vidora", tracks: [] }] }
 * Failure shape: { result: false, message: "Movie not yet encoded", ... }
 *
 * The returned source URLs are already wrapped in a CORS-enabled
 * workers.dev proxy by the upstream itself.
 */
function adaptVidora(json: any): NormalizedStream | undefined {
  if (!json || typeof json !== "object" || json.result !== true) return undefined;

  const sources: any[] = Array.isArray(json.sources) ? json.sources : [];

  // Tracks → captions ({ file | url, label, language } shapes).
  const captions: NormalizedCaption[] = [];
  for (const s of sources) {
    const tracks = Array.isArray(s?.tracks) ? s.tracks : [];
    for (const t of tracks) {
      const url = t?.file ?? t?.url;
      if (!looksLikeUrl(url)) continue;
      captions.push({
        id: `vidora-cap-${captions.length}`,
        language: String(t.language ?? t.lang ?? t.srclang ?? "en"),
        url,
        display: t.label ?? t.language ?? "Subtitles",
        // Served through the same CORS-open worker as the video.
        hasCorsRestrictions: false,
      });
    }
  }

  const urls = sources
    .map((s) => s?.url)
    .filter((u: unknown): u is string => looksLikeUrl(u));
  if (urls.length === 0) return undefined;

  const hls = urls.find(isHlsUrl);
  if (hls) {
    return hlsFromUrl(hls, {
      captions,
      label: `Vidora${json.title ? ` · ${json.title}` : ""}`,
    });
  }

  const mp4s = urls.filter(isMp4Url);
  if (mp4s.length > 0) {
    return fileFromQualities(
      mp4s.map((u) => ({ quality: "unknown", url: u, type: "mp4" as const })),
      { captions },
    );
  }

  // Unknown URL type — hand the first one to the player as HLS.
  return hlsFromUrl(urls[0], {
    captions,
    label: `Vidora${json.title ? ` · ${json.title}` : ""}`,
  });
}

/* ------------------------------------------------------------------ */
/*  dispatcher                                                         */
/* ------------------------------------------------------------------ */

export function adaptResponse(
  responseType: string | undefined,
  body: unknown,
): NormalizedStream | undefined {
  switch (responseType) {
    case "opstream":
      return adaptOpstream(body);
    case "bingr":
      return adaptBingr(body);
    case "aether_tiki":
      return adaptAetherTiki(body);
    case "aether_meridian":
      return adaptAetherMeridian(body);
    case "vidnest":
      return adaptVidnest(body);
    case "sources":
      return adaptSources(body);
    case "qualities":
      return adaptQualities(body);
    case "stream":
      return adaptStream(body);
    case "streams":
      return adaptStreams(body);
    case "stream_url":
    case "streamUrl":
      return adaptStreamUrl(body);
    case "source_string":
      return adaptSourceString(body);
    case "source_object":
      return adaptSourceObject(body);
    case "miroru":
      return adaptMiroru(body);
    case "url":
      return adaptUrl(body);
    case "hable":
      return adaptHable(body);
    case "lordflix":
      return adaptLordflix(body);
    case "zoko":
      return adaptZoko(body);
    case "anivexa":
      return adaptAnivexa(body);
    case "vidfast":
      return adaptVidfast(body);
    case "xpass":
      return adaptXpass(body);
    case "vidora":
      return adaptVidora(body);
    default:
      // Unknown responseType — try a series of fallbacks.
      return (
        adaptStream(body) ??
        adaptStreamUrl(body) ??
        adaptSources(body) ??
        adaptQualities(body) ??
        adaptSourceString(body)
      );
  }
}
