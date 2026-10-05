/**
 * ══════════════════════════════════════════════════════════════
 *  CINETARO API — SERVER CONFIGURATION
 * ══════════════════════════════════════════════════════════════
 *
 *  Add your servers here. The player will try them in order
 *  and auto-switch to the next one if a server fails.
 *
 *  FIELDS:
 *    name       — Display name in the player dropdown
 *    base       — Server API base URL
 *    proxy      — (optional) URL prefix to replace base in stream URLs
 *    referer    — (optional) Send Referer header when fetching
 *    timeout    — (optional) Fetch timeout in ms (default: 8000)
 *    headers    — (optional) Extra headers to send
 *    path       — (optional) URL path pattern. Variables: {id}, {season}, {episode}
 *                 Default: /tv/{id}/{season}/{episode}  or  /movie/{id}
 *
 *  EXAMPLE:
 *    {
 *      name: "My Server",
 *      base: "https://example.com/api",
 *      proxy: "https://my-proxy.workers.dev",
 *      referer: true,
 *      timeout: 10000,
 *    }
 *
 * ══════════════════════════════════════════════════════════════
 */

export interface ServerConfig {
  name: string;
  base: string;
  proxy?: string;
  /** CORS proxy prefix prepended to stream URLs in the browser (e.g. "https://my-cors-proxy.workers.dev/") */
  streamProxy?: string;
  referer?: boolean;
  timeout?: number;
  path?: string;
  tvPath?: string;
  responseType?:
    | "stream"
    | "sources"
    | "streams"
    | "stream_url"
    | "qualities"
    | "source_string"
    | "aether_meridian"
    | "vidnest"
    | "aether_tiki"
    | "streamUrl"
    | "source_object"
    | "opstream"
    | "bingr";
  headers?: Record<string, string>;
  quality?: string;
}

const SERVERS: ServerConfig[] = [
  // ── Armor (OpStream) — proxied through server so real URL is hidden ──
  {
    name: "Armor",
    base: "/api/ext/opstream/api",
    path: "/api/ext/opstream/api/movie/{id}",
    tvPath: "/api/ext/opstream/api/tv/{id}/{season}/{episode}",
    responseType: "opstream",
    timeout: 15000,
  },

  // ── Kuro (Bingr) — proxied through server so real URL is hidden ──
  {
    name: "Kuro",
    base: "/api/ext/bingr",
    path: "/api/ext/bingr/api/movie/{id}",
    tvPath: "/api/ext/bingr/api/tv/{id}/{season}/{episode}",
    responseType: "bingr",
    quality: "1080p",
    timeout: 15000,
  },

  // ── Tiki (Aether) — proxied through server so real URL is hidden ──
  {
    name: "Tiki",
    base: "/api/ext/aether",
    path: "/api/ext/aether/api/movie/{id}?server=4",
    tvPath: "/api/ext/aether/api/show/{id}/{season}/{episode}?server=4",
    responseType: "aether_tiki",
    timeout: 15000,
  },

  // ── Atlas (VidRock) — proxied through server so real URL is hidden ──
  {
    name: "Atlas",
    base: "/api/ext/vidrock",
    path: "/api/ext/vidrock/api/movie/{id}",
    tvPath: "/api/ext/vidrock/api/tv/{id}/{season}/{episode}",
    responseType: "sources",
    quality: "1080p",
    timeout: 15000,
  },
];

export default SERVERS;
