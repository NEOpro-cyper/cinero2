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
 * is what the Zoko anime server expects
 * (/api/mal/{category}/{malId}/{episode}?worker=1).
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
  // {category} placeholder — e.g. the Zoko anime server).
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
 * declare "anime" — so Hable/Nest/Luna/Orion/Light/Space/Kuro/Tiki/
 * Popins/Meridian/CinetaroCDN are skipped for anime, and Zoko is
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

  const stream = adaptResponse(server.responseType, body);
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
