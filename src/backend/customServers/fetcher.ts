/**
 * URL building + fetch + dispatch logic for custom API servers.
 */

import { conf } from "@/setup/config";

import { adaptResponse } from "./adapters";
import type { ServerConfig } from "./config";
import {
  CustomScrapeMedia,
  NormalizedStream,
  ScrapeCustomServerResult,
} from "./types";

/** Build the URL for a given server + media, substituting {id}/{season}/{episode}/{category}.
 *
 * For anime media (media.malId is set), the {id} placeholder is
 * replaced with the MyAnimeList anime ID instead of the TMDB id. This
 * is what the Kitsune anime server expects (Zoko upstream:
 * /api/mal/{category}/{malId}/{episode}?worker=1).
 *
 * {category} is the Sub/Dub placeholder ("sub" | "dub").
 * It always comes from media.miroruCategory (preferences,
 * default "sub") — the user picks sub/dub via the player settings menu.
 */
export function buildServerUrl(
  server: ServerConfig,
  media: CustomScrapeMedia,
): string {
  const isShow = media.type === "show";
  const pattern = isShow
    ? (server.tvPath ??
      server.path ??
      `${server.base}/tv/{id}/{season}/{episode}`)
    : (server.path ?? `${server.base}/movie/{id}`);

  // For anime, prefer the MAL ID. For non-anime, use the TMDB id.
  const idValue = media.malId
    ? String(media.malId)
    : encodeURIComponent(media.tmdbId);

  // Sub/Dub category (only used when the pattern contains the
  // {category} placeholder — e.g. the anime servers).
  const categoryValue = media.miroruCategory ?? "sub";

  return pattern
    .replace(/\{id\}/g, idValue)
    .replace(/\{season\}/g, String(media.season?.number ?? 1))
    .replace(/\{episode\}/g, String(media.episode?.number ?? 1))
    .replace(/\{category\}/g, encodeURIComponent(categoryValue));
}

/**
 * Should this server be attempted for the given media?
 *
 * Each server declares which media types it supports via `mediaTypes`
 * (defaults to ["movie", "show"] for TMDB-based servers). Anime media
 * (URL pattern: /media/mal-<id>-<slug>) only matches servers that
 * declare "anime" — so Hable/Comet/Luna/Vega/Lumen/Astra/Kuro/Tiki/
 * Popins/Meridian/CinetaroCDN are skipped for anime, and Kitsune is
 * skipped for movies/shows.
 */
export function isServerApplicableForMedia(
  server: ServerConfig,
  media: CustomScrapeMedia,
): boolean {
  const supported = server.mediaTypes ?? ["movie", "show"];
  const mediaType = media.malId ? "anime" : media.type;
  return supported.includes(mediaType as "movie" | "show" | "anime");
}

/** Apply a stream proxy (if configured) to a stream URL. */
export function applyStreamProxy(url: string, server: ServerConfig): string {
  if (!server.streamProxy) return url;
  // streamProxy is a prefix (e.g. "https://my-cors-proxy.workers.dev/?url=")
  if (server.streamProxy.endsWith("=") || server.streamProxy.endsWith("?")) {
    return `${server.streamProxy}${encodeURIComponent(url)}`;
  }
  if (server.streamProxy.endsWith("/")) {
    return `${server.streamProxy}${url}`;
  }
  return `${server.streamProxy}/${url}`;
}

/** Pick the global CORS proxy (from env / public/config.js) if available. */
function getGlobalCorsProxy(): string | undefined {
  const urls = conf().PROXY_URLS ?? [];
  return urls.length > 0 ? urls[0] : undefined;
}

/** Maybe wrap a URL with the global CORS proxy if we're in the browser and the host isn't CORS-friendly. */
function maybeCorsProxy(url: string): string {
  // Most of the upstream APIs already set `Access-Control-Allow-Origin: *`,
  // but the *stream URLs* they return (m3u8/mp4) often do NOT. So we route
  // them through the user's configured CORS proxy if one is set.
  const proxy = getGlobalCorsProxy();
  if (!proxy) return url;
  if (url.startsWith(proxy)) return url;
  // Some proxies expect raw URL appended; some expect encoded. Use encoded
  // form because that's what `corsproxy.io`-style and `simple-proxy` workers
  // expect.
  if (proxy.endsWith("=") || proxy.endsWith("?")) {
    return `${proxy}${encodeURIComponent(url)}`;
  }
  if (proxy.endsWith("/")) {
    return `${proxy}${url}`;
  }
  return `${proxy}/${url}`;
}

function buildHeaders(server: ServerConfig): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  };
  if (server.referer) {
    try {
      const u = new URL(server.base);
      h.Referer = `${u.protocol}//${u.host}/`;
    } catch {
      // ignore
    }
  }
  if (server.headers) Object.assign(h, server.headers);
  return h;
}

async function fetchWithTimeout(
  url: string,
  opts: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/*  Xpass (Pulsar) resolution                                          */
/* ------------------------------------------------------------------ */

/**
 * Rewrite a play.xpass.top playlist URL to the same-origin reverse proxy
 * so the browser never talks to the CF-protected host directly:
 *   https://play.xpass.top/mdata/.../playlist.json
 *     → /api/ext/xpassplay/mdata/.../playlist.json
 *
 * The proxy forwards the browser's real User-Agent, which is enough to
 * pass Cloudflare (verified: browser UA → HTTP 200, curl UA → challenge).
 */
function rewriteXpassPlaylistUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === "play.xpass.top") {
      return `/api/ext/xpassplay${u.pathname}${u.search}`;
    }
  } catch {
    // not a URL — return as-is
  }
  return url;
}

/** Fetch one xpass playlist.json through the reverse proxy. */
async function fetchXpassPlaylist(
  url: string,
  timeoutMs: number,
): Promise<any | undefined> {
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { Accept: "application/json, text/plain, */*" }, credentials: "omit" },
      timeoutMs,
    );
    if (!res.ok) return undefined;
    // A Cloudflare challenge page arrives as text/html — treat as failure
    // so the caller can try the next playlist.
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("text/html")) return undefined;
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  } catch {
    return undefined;
  }
}

/**
 * Xpass step 1 returns only playlist.json URLs (one per upstream server);
 * the actual HLS manifests live inside those JSON files. Fetch them here
 * (selected server first, up to 4 attempts) and merge the parsed
 * playlists into the body so the `xpass` adapter can pick a stream.
 */
async function resolveXpassPlaylists(body: any): Promise<any> {
  const servers: any[] = Array.isArray(body?.servers) ? body.servers : [];
  const selected = body?.selectedServer;
  // Stable-sort the selected server first, keep the advertised order after.
  const ordered = [...servers].sort(
    (a, b) => Number(b?.name === selected) - Number(a?.name === selected),
  );

  const playlists: Array<{ server: string; data: any }> = [];
  for (const entry of ordered.slice(0, 4)) {
    if (!entry?.url || typeof entry.url !== "string") continue;
    const data = await fetchXpassPlaylist(
      rewriteXpassPlaylistUrl(entry.url),
      10000,
    );
    if (data) {
      playlists.push({ server: entry.name ?? "xpass", data });
      break; // first playable playlist is enough
    }
  }

  return { ...body, playlists };
}

/**
 * Does the step-1 body already carry a ready-to-play sources[] entry?
 * The upstream resolves streams server-side and includes sources[] on
 * BOTH cache HITs and fresh MISSes (verified live) — when present, NO
 * playlist.json round-trip is needed; the file URL plays directly.
 */
function xpassHasDirectSources(body: any): boolean {
  const sources: any[] = Array.isArray(body?.sources) ? body.sources : [];
  return sources.some(
    (s) =>
      s &&
      typeof s.file === "string" &&
      /^https?:\/\//i.test(s.file) &&
      !/playlist\.json/i.test(s.file),
  );
}

/** Upstream language names ("english") → ISO-639-1-ish codes ("en"). */
const XPASS_LANG_CODES: Record<string, string> = {
  english: "en", arabic: "ar", french: "fr", spanish: "es", german: "de",
  italian: "it", portuguese: "pt", russian: "ru", japanese: "ja",
  korean: "ko", chinese: "zh", mandarin: "zh", cantonese: "zh",
  hindi: "hi", urdu: "ur", bengali: "bn", tamil: "ta", telugu: "te",
  turkish: "tr", indonesian: "id", malay: "ms", filipino: "tl",
  thai: "th", vietnamese: "vi", dutch: "nl", polish: "pl",
  swedish: "sv", danish: "da", norwegian: "no", finnish: "fi",
  greek: "el", hebrew: "he", persian: "fa", ukrainian: "uk",
  czech: "cs", romanian: "ro", hungarian: "hu",
};

function xpassLangCode(v: unknown): string {
  const k = String(v ?? "").trim().toLowerCase();
  if (XPASS_LANG_CODES[k]) return XPASS_LANG_CODES[k];
  return k.length === 2 || k.length === 3 ? k : k.slice(0, 2);
}

/**
 * The step-1 response carries `subtitles` as a URL to a JSON index
 * (e.g. https://sub.1x2.space/api/tv/276161/1/1 → [{label, language,
 * url: "/subtitle/.../English.vtt"}]). The index AND the VTT files are
 * CORS-open (ACAO: *), so the browser fetches the index directly — no
 * proxy hop, no /api/ext request. Resolved entries are attached as
 * `subtitlesList` for the adapter. Any failure is silent: playback
 * continues without captions.
 */
async function resolveXpassSubtitles(body: any): Promise<any> {
  const indexUrl = body?.subtitles;
  if (typeof indexUrl !== "string" || !/^https?:\/\//i.test(indexUrl)) {
    return body;
  }
  try {
    const res = await fetchWithTimeout(
      indexUrl,
      { headers: { Accept: "application/json" }, credentials: "omit" },
      8000,
    );
    if (!res.ok) return body;
    const list = await res.json();
    if (!Array.isArray(list)) return body;
    let base: URL;
    try {
      base = new URL(indexUrl);
    } catch {
      return body;
    }
    const subtitlesList = list
      .filter((s: any) => s && typeof s.url === "string" && s.url.length > 0)
      .map((s: any, i: number) => ({
        id: `xpass-cap-${i}`,
        language: xpassLangCode(s.language ?? s.label),
        url: new URL(s.url, base).toString(),
        display: s.label ?? s.language ?? "Subtitles",
        isDefault: xpassLangCode(s.language ?? s.label) === "en",
      }));
    return { ...body, subtitlesList };
  } catch {
    return body;
  }
}

/**
 * Fetch a stream from a custom server.
 * Returns a NormalizedStream on success, or throws on failure.
 */
export async function fetchCustomServerStream(
  server: ServerConfig,
  media: CustomScrapeMedia,
): Promise<NormalizedStream> {
  const url = buildServerUrl(server, media);
  const timeout = server.timeout ?? 12000;
  const headers = buildHeaders(server);

  let res: Response;
  try {
    res = await fetchWithTimeout(
      url,
      { headers, credentials: "omit" },
      timeout,
    );
  } catch (err: any) {
    throw new Error(
      `Custom server "${server.name}" fetch failed: ${err?.message ?? String(err)}`,
    );
  }

  if (!res.ok) {
    let bodyText = "";
    try {
      bodyText = await res.text();
    } catch {
      // ignore
    }
    throw new Error(
      `Custom server "${server.name}" returned HTTP ${res.status}: ${bodyText.slice(0, 200)}`,
    );
  }

  const ct = res.headers.get("content-type") ?? "";
  let body: unknown;
  if (ct.includes("application/json") || ct.includes("text/")) {
    const text = await res.text();
    // Try JSON first; fall back to raw string (for source_string servers).
    try {
      body = JSON.parse(text);
    } catch {
      body = text.trim();
    }
  } else {
    // Unknown content type — try JSON anyway.
    try {
      body = await res.json();
    } catch {
      try {
        body = await res.text();
      } catch {
        throw new Error(
          `Custom server "${server.name}" returned unparseable body`,
        );
      }
    }
  }

  // Xpass: the upstream now resolves streams server-side and returns
  // ready-to-play sources[] in the FIRST response (cache HIT or MISS) —
  // pass that straight through, zero extra requests. Only when sources[]
  // is empty do we fall back to the legacy playlist.json resolution
  // (via /api/ext/xpassplay/*). The subtitle index URL is resolved here
  // too (direct browser fetch — sub.1x2.space sends ACAO: *).
  let bodyForAdapter: unknown = body;
  if (server.responseType === "xpass" && body && typeof body === "object") {
    let xpassBody: any = body;
    if (!xpassHasDirectSources(xpassBody)) {
      xpassBody = await resolveXpassPlaylists(xpassBody);
    }
    xpassBody = await resolveXpassSubtitles(xpassBody);
    bodyForAdapter = xpassBody;
  }

  const stream = adaptResponse(server.responseType, bodyForAdapter);
  if (!stream) {
    throw new Error(
      `Custom server "${server.name}" (${server.responseType ?? "auto"}) returned no usable stream`,
    );
  }

  // Apply stream proxy if configured (per-server or global).
  const applyProxy = (u: string | undefined): string | undefined =>
    u ? maybeCorsProxy(applyStreamProxy(u, server)) : u;

  if (stream.type === "hls" && stream.url) {
    stream.url = applyProxy(stream.url);
  } else if (stream.type === "file" && stream.qualities) {
    stream.qualities = stream.qualities.map((q) => ({
      ...q,
      url: applyProxy(q.url) ?? q.url,
    }));
  }
   if (stream.captions) {
    stream.captions = stream.captions.map((c) => ({
      ...c,
      url: applyProxy(c.url) ?? c.url,
      // Only default to `true` when the adapter didn't decide already
      // (Zoko subs are served by the same CORS-enabled worker as the video).
      hasCorsRestrictions: c.hasCorsRestrictions ?? true,
    }));
  }

  return stream;
}

/**
 * Scrape a custom server end-to-end. Returns a synthetic ScrapeCustomServerResult
 * that can be converted to a RunOutput upstream.
 */
export async function scrapeCustomServer(
  server: ServerConfig,
  sourceId: string,
  media: CustomScrapeMedia,
): Promise<ScrapeCustomServerResult> {
  const stream = await fetchCustomServerStream(server, media);
  return {
    sourceId,
    sourceName: server.name,
    stream,
  };
}
