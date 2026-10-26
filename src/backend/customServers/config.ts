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
 *    base       — Server API base URL. Use a RELATIVE /api/ext/... URL
 *                 so the browser never sees the real upstream host —
 *                 server.js reverse-proxies it to the real server.
 *    proxy      — (optional) URL prefix to replace base in stream URLs
 *    referer    — (optional) Send Referer header when fetching
 *    timeout    — (optional) Fetch timeout in ms (default: 8000)
 *    headers    — (optional) Extra headers to send
 *    path       — (optional) URL path pattern. Variables: {id}, {season},
 *                 {episode}, {category}
 *                 Default: /tv/{id}/{season}/{episode}  or  /movie/{id}
 *    mediaTypes — (optional) Which media types this server handles.
 *                 Defaults to ["movie", "show"]. Anime-only servers
 *                 (Zoko) declare ["anime"].
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
 *  ANIME (Zoko):
 *    Upstream URL pattern: .../api/mal/{sub|dub}/{malId}/{episode}?worker=1
 *    (proxied as /api/ext/zoko/api/mal/... so the real host stays hidden)
 *    {id}       → the MyAnimeList ID (from the Jikan metadata layer)
 *    {category} → "sub" or "dub" (from the player's Sub/Dub setting)
 *    {episode}  → episode number (1 for movies / single-episode anime)
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
    | "bingr"
    | "miroru"
    | "url"
    | "hable"
    | "lordflix"
    | "zoko"
    | "vidfast"
    | "xpass"
    | "vidora";
  headers?: Record<string, string>;
  quality?: string;
  /**
   * Which media types this server can handle. Defaults to ["movie", "show"]
   * (i.e. TMDB-based servers). Anime-only servers (Zoko) declare ["anime"].
   *
   * When the player loads an anime (URL pattern: /media/mal-<id>-<slug>),
   * only servers with "anime" in their mediaTypes list are tried — movie/show
   * servers are skipped because they don't understand MAL ids.
   */
  mediaTypes?: Array<"movie" | "show" | "anime">;
}

const SERVERS: ServerConfig[] = [
  // ── Zoko (anime-only) — Jikan/MAL-based streaming API ──
  // Anime only — uses MyAnimeList ids, would 404 for TMDB ids.
  // Skipped for movies/shows (see mediaTypes).
  //
  // Upstream URL pattern: /api/mal/{category}/{malId}/{episode}?worker=1
  //   {category} → "sub" or "dub" (from the player's Sub/Dub setting)
  //   {id}       → the MAL anime ID (set from meta.malId)
  //   {episode}  → episode number (1 for movies / single-episode anime)
  //
  // All requests go through the server-side reverse proxy at
  // /api/ext/zoko/* — the browser never sees zoko.speedoflight.buzz.
  //
  // Response shape: { ok, stream_url, subtitles: [{lang, label, src}], skip }
  // → handled by the "zoko" adapter.
  {
    name: "Zoko",
    base: "/api/ext/zoko",
    path: "/api/ext/zoko/api/mal/{category}/{id}/1?worker=1",
    tvPath: "/api/ext/zoko/api/mal/{category}/{id}/{episode}?worker=1",
    responseType: "zoko",
    timeout: 20000,
    mediaTypes: ["anime"],
  },

  // ── Interstellar (Vidfast, server=1) ──
  {
    name: "Interstellar",
    base: "/api/ext/vidfast",
    path: "/api/ext/vidfast/api/movie/{id}?server=1&worker=1&data=en",
    tvPath:
      "/api/ext/vidfast/api/tv/{id}/{season}/{episode}?server=1&worker=1&data=en",
    responseType: "vidfast",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Nova (Vidfast, server=2) ──
  {
    name: "Nova",
    base: "/api/ext/vidfast",
    path: "/api/ext/vidfast/api/movie/{id}?server=2&worker=1&data=en",
    tvPath:
      "/api/ext/vidfast/api/tv/{id}/{season}/{episode}?server=2&worker=1&data=en",
    responseType: "vidfast",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Pulsar (XPass, server=1) ──
  {
    name: "Pulsar",
    base: "/api/ext/xpass",
    path: "/api/ext/xpass/movie/{id}?server=1&worker=1&data=en",
    tvPath:
      "/api/ext/xpass/tv/{id}/{season}/{episode}?server=1&worker=1&data=en",
    responseType: "xpass",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Andromeda (Vidnest) ──
  {
    name: "Andromeda",
    base: "/api/ext/nest",
    path: "/api/ext/nest/api/movie/{id}?data=en",
    tvPath: "/api/ext/nest/api/tv/{id}/{season}/{episode}?data=en",
    responseType: "vidnest",
    quality: "1080p",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Orion (VidRock, server=orion) ──
  {
    name: "Orion",
    base: "/api/ext/vidrock",
    path: "/api/ext/vidrock/api/movie/{id}?server=orion&worker=1&data=en",
    tvPath:
      "/api/ext/vidrock/api/tv/{id}/{season}/{episode}?server=orion&worker=1&data=en",
    responseType: "sources",
    quality: "1080p",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Cosmo (Movy, server=miami) ──
  {
    name: "Cosmo",
    base: "/api/ext/movy",
    path: "/api/ext/movy/api/movie/{id}?server=miami&worker=1&data=en",
    tvPath:
      "/api/ext/movy/api/tv/{id}/{season}/{episode}?server=miami&worker=1&data=en",
    responseType: "sources",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Quasar (Vidora / movies-api) ──
  // { result, type, title, tmdb_id, sources: [{ file_code, url (m3u8), source, tracks: [{ label, file (vtt) }] }] }
  {
    name: "Quasar",
    base: "/api/ext/vidora",
    path: "/api/ext/vidora/api/movie/{id}?worker=1&data=en",
    tvPath:
      "/api/ext/vidora/api/tv/{id}/{season}/{episode}?worker=1&data=en",
    responseType: "vidora",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Stellar (Lordflix, server=Lisbon) ──
  {
    name: "Stellar",
    base: "/api/ext/lordflix",
    path: "/api/ext/lordflix/api/movie/{id}?server=Lisbon&worker=1&data=en",
    tvPath:
      "/api/ext/lordflix/api/tv/{id}/{season}/{episode}?server=Lisbon&worker=1&data=en",
    responseType: "lordflix",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Nebula (Lordflix, server=nebula) ──
  {
    name: "Nebula",
    base: "/api/ext/lordflix",
    path: "/api/ext/lordflix/api/movie/{id}?server=nebula&worker=1&data=en",
    tvPath:
      "/api/ext/lordflix/api/tv/{id}/{season}/{episode}?server=nebula&worker=1&data=en",
    responseType: "lordflix",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Apollo (Lordflix, server=Scout) ──
  {
    name: "Apollo",
    base: "/api/ext/lordflix",
    path: "/api/ext/lordflix/api/movie/{id}?server=Scout&worker=1&data=en",
    tvPath:
      "/api/ext/lordflix/api/tv/{id}/{season}/{episode}?server=Scout&worker=1&data=en",
    responseType: "lordflix",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Zenith (Cinetaro CDN — atlantic embek) ──
  {
    name: "Zenith",
    base: "/api/ext/cinetarocdn",
    path: "/api/ext/cinetarocdn/api/embek?tmdb_id={id}&type=movie",
    tvPath:
      "/api/ext/cinetarocdn/api/embek?tmdb_id={id}&type=tv&season={season}&episode={episode}",
    responseType: "qualities",
    quality: "1080p",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  /* ── Previous servers (kept for reference) ──────────────────────────

  // ── Nest (Vidnest, old query style) ──
  {
    name: "Nest",
    base: "/api/ext/nest",
    path: "/api/ext/nest/api/movie/{id}?worker=1",
    tvPath: "/api/ext/nest/api/tv/{id}/{season}/{episode}?worker=1",
    responseType: "vidnest",
    quality: "1080p",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Luna (VidRock, server=luna — MP4/HLS multi-quality) ──
  {
    name: "Luna",
    base: "/api/ext/vidrock",
    path: "/api/ext/vidrock/api/movie/{id}?server=luna&worker=1",
    tvPath: "/api/ext/vidrock/api/tv/{id}/{season}/{episode}?server=luna&worker=1",
    responseType: "sources",
    quality: "1080p",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Space (Lordflix, server=Scout — old query style) ──
  {
    name: "Space",
    base: "/api/ext/lordflix",
    path: "/api/ext/lordflix/api/movie/{id}?server=Scout&worker=1",
    tvPath: "/api/ext/lordflix/api/tv/{id}/{season}/{episode}?server=Scout&worker=1",
    responseType: "lordflix",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Light (Lordflix, server=Lisbon — old query style) ──
  {
    name: "Light",
    base: "/api/ext/lordflix",
    path: "/api/ext/lordflix/api/movie/{id}?server=Lisbon&worker=1",
    tvPath: "/api/ext/lordflix/api/tv/{id}/{season}/{episode}?server=Lisbon&worker=1",
    responseType: "lordflix",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── CinetaroCDN (old name of Zenith, quality AUTO) ──
  {
    name: "CinetaroCDN",
    base: "/api/ext/cinetarocdn",
    path: "/api/ext/cinetarocdn/api/embek?tmdb_id={id}&type=movie",
    tvPath: "/api/ext/cinetarocdn/api/embek?tmdb_id={id}&type=tv&season={season}&episode={episode}",
    responseType: "qualities",
    quality: "AUTO",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Hable (Vidrift) ──
  // Response shape: { url: "https://...m3u8" } → handled by the "url" adapter.
  {
    name: "Hable",
    base: "/api/ext/hable",
    path: "/api/ext/hable/api/movie/{id}",
    tvPath: "/api/ext/hable/api/tv/{id}/{season}/{episode}",
    responseType: "url",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Kuro (Bingr Proxy API) ──
  {
    name: "Kuro",
    base: "/api/ext/bingr",
    path: "/api/ext/bingr/api/movie/{id}",
    tvPath: "/api/ext/bingr/api/tv/{id}/{season}/{episode}",
    responseType: "bingr",
    quality: "1080p",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Tiki (Aether Serv-3) ──
  {
    name: "Tiki",
    base: "/api/ext/aether",
    path: "/api/ext/aether/api/movie/{id}?server=4",
    tvPath: "/api/ext/aether/api/show/{id}/{season}/{episode}?server=4",
    responseType: "aether_tiki",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Popins (OpStream API v2) ──
  {
    name: "Popins",
    base: "/api/ext/opstream/api",
    path: "/api/ext/opstream/api/movie/{id}",
    tvPath: "/api/ext/opstream/api/tv/{id}/{season}/{episode}",
    responseType: "url",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Meridian (Aether Serv-2) ──
  {
    name: "Meridian",
    base: "/api/ext/aether",
    path: "/api/ext/aether/api/movie/{id}?server=2",
    tvPath: "/api/ext/aether/api/show/{id}/{season}/{episode}?server=2",
    responseType: "aether_meridian",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  ──────────────────────────────────────────────────────────────────── */
];

export default SERVERS;
