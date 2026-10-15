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
 *                 (Sakura / Kitsune) declare ["anime"].
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
 *  ANIME (Kitsune — Zoko upstream):
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
    | "anivexa"
    | "vidfast"
    | "xpass"
    | "vidora";
  headers?: Record<string, string>;
  quality?: string;
  /**
   * Which media types this server can handle. Defaults to ["movie", "show"]
   * (i.e. TMDB-based servers). Anime-only servers (Sakura / Kitsune) declare ["anime"].
   *
   * When the player loads an anime (URL pattern: /media/mal-<id>-<slug>),
   * only servers with "anime" in their mediaTypes list are tried — movie/show
   * servers are skipped because they don't understand MAL ids.
   */
  mediaTypes?: Array<"movie" | "show" | "anime">;
}

const SERVERS: ServerConfig[] = [
  // ── Sakura (anime-only) — Anivexa upstream, MAL-based (Anikoto sources) ──
  // Anime only — uses MyAnimeList ids, would 404 for TMDB ids.
  // Skipped for movies/shows (see mediaTypes).
  //
  // Upstream URL pattern:
  //   https://anivexa-api-sigma.vercel.app/watch/anikoto/{malId}/{sub|dub}/anikoto-{episode}?worker=1
  //   {id}       → the MyAnimeList ID (cross-linked on AniList via idMal)
  //   {category} → "sub" or "dub" (from the player's Sub/Dub setting)
  //   {episode}  → episode number (embedded in the "anikoto-{episode}"
  //                path segment — the {episode} placeholder replaces ALL
  //                occurrences, so "anikoto-{episode}" works directly)
  //
  // All requests go through the server-side reverse proxy at
  // /api/ext/anivexa/* — the browser never sees the Vercel host.
  //
  // Response shape:
  //   { anilistId, malId, episode, audio, streams: [...], subtitles: [...] }
  //   streams[] entries: { url (HLS, already CORS-proxied via worker),
  //     type: "hls" | "embed", server: "HD-1", subtitles: [{url, label,
  //     srclang, default}], priority, isActive, intro, outro }
  //   → handled by the "anivexa" adapter.
  {
    name: "Sakura",
    base: "/api/ext/anivexa",
    path: "/api/ext/anivexa/watch/anikoto/{id}/{category}/anikoto-1?worker=1",
    tvPath:
      "/api/ext/anivexa/watch/anikoto/{id}/{category}/anikoto-{episode}?worker=1",
    responseType: "anivexa",
    timeout: 20000,
    mediaTypes: ["anime"],
  },

  // ── Kitsune (anime-only) — Zoko upstream, Jikan/MAL-based ──
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
    name: "Kitsune",
    base: "/api/ext/zoko",
    path: "/api/ext/zoko/api/mal/{category}/{id}/1?worker=1",
    tvPath: "/api/ext/zoko/api/mal/{category}/{id}/{episode}?worker=1",
    responseType: "zoko",
    timeout: 20000,
    mediaTypes: ["anime"],
  },

  // ── Hable (Vidrift) ──
  // Response shape: { url: "https://...m3u8" } → handled by the "url" adapter.
//  {
  //  name: "Hable",
 //   base: "/api/ext/hable",
//    path: "/api/ext/hable/api/movie/{id}",
//    tvPath: "/api/ext/hable/api/tv/{id}/{season}/{episode}",
//    responseType: "url",
//    timeout: 15000,
//    mediaTypes: ["movie", "show"],
//  },

  // ── Nebula (Vidfast upstream, server=1) ──
  // Confirmed live shape: { success: true, url: "https://<cors-worker>/https://.../master.m3u8",
  //   originalUrl, server: { name: "vBlaze" }, ... } → "vidfast" adapter.
  {
    name: "Nebula",
    base: "/api/ext/vidfast",
    path: "/api/ext/vidfast/api/movie/{id}?server=1&worker=1",
    tvPath: "/api/ext/vidfast/api/tv/{id}/{season}/{episode}?server=1&worker=1",
    responseType: "vidfast",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Quasar (Vidfast upstream, server=2) ──
  // Same API + same response shape as Nebula, different backend server.
  {
    name: "Quasar",
    base: "/api/ext/vidfast",
    path: "/api/ext/vidfast/api/movie/{id}?server=2&worker=1",
    tvPath: "/api/ext/vidfast/api/tv/{id}/{season}/{episode}?server=2&worker=1",
    responseType: "vidfast",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Pulsar (Xpass upstream) ──
  // TWO-STEP API: step 1 returns { servers: [{ name, url: playlist.json }] },
  // step 2 fetches the playlist.json (play.xpass.top, CF-protected —
  // resolved server-side via /api/ext/xpassplay/*) which contains the
  // actual HLS manifest. Handled by the "xpass" adapter + fetcher hook.
  {
    name: "Pulsar",
    base: "/api/ext/xpass",
    path: "/api/ext/xpass/api/movie/{id}?server=1&worker=1",
    tvPath: "/api/ext/xpass/api/tv/{id}/{season}/{episode}?server=1&worker=1",
    responseType: "xpass",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Comet (Vidnest upstream) ──
  {
    name: "Comet",
    base: "/api/ext/nest",
    path: "/api/ext/nest/api/movie/{id}?worker=1",
    tvPath: "/api/ext/nest/api/tv/{id}/{season}/{episode}?worker=1",
    responseType: "vidnest",
    quality: "1080p",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Luna (VidRock, server=luna — MP4/HLS multi-quality) ──
  //{
 //   name: "Luna",
 //   base: "/api/ext/vidrock",
 //   path: "/api/ext/vidrock/api/movie/{id}?server=luna&worker=1",
 //   tvPath: "/api/ext/vidrock/api/tv/{id}/{season}/{episode}?server=luna&worker=1",
 //   responseType: "sources",
//    quality: "1080p",
 //   timeout: 15000,
//    mediaTypes: ["movie", "show"],
 // },

  // ── Vega (VidRock upstream, server=orion) ──
  {
    name: "Vega",
    base: "/api/ext/vidrock",
    path: "/api/ext/vidrock/api/movie/{id}?server=orion&worker=1",
    tvPath: "/api/ext/vidrock/api/tv/{id}/{season}/{episode}?server=orion&worker=1",
    responseType: "sources",
    quality: "1080p",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Astra (Lordflix upstream, server=Scout & worker=1) ──
  {
    name: "Astra",
    base: "/api/ext/lordflix",
    path: "/api/ext/lordflix/api/movie/{id}?server=Scout&worker=1",
    tvPath: "/api/ext/lordflix/api/tv/{id}/{season}/{episode}?server=Scout&worker=1",
    responseType: "lordflix",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Solara (Lordflix-family upstream on movy-bz host, server=miami) ──
  // Confirmed live shape: { sources: [{quality: "1080p", url: ...m3u8}, ...],
  //   subtitles: [], playlist: "...master.m3u8", server: "miami" }
  // → "lordflix" adapter (playlist preferred, sources[] as fallback).
  {
    name: "Solara",
    base: "/api/ext/miami",
    path: "/api/ext/miami/api/movie/{id}?server=miami&worker=1",
    tvPath: "/api/ext/miami/api/tv/{id}/{season}/{episode}?server=miami&worker=1",
    responseType: "lordflix",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

  // ── Zenith (Vidora upstream) ──
  // Confirmed live shape: { result: true, sources: [{ url: "https://<cors-worker>/.../master.m3u8",
  //   tracks: [] }] }; failure: { result: false, message: "Movie not yet encoded" }
  // → "vidora" adapter (result:false → undefined → auto-failover).
  {
    name: "Zenith",
    base: "/api/ext/vidora",
    path: "/api/ext/vidora/api/movie/{id}?worker=1",
    tvPath: "/api/ext/vidora/api/tv/{id}/{season}/{episode}?worker=1",
    responseType: "vidora",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },

   // ── Lumen (Lordflix upstream, server=Lisbon) ──
  {
    name: "Lumen",
    base: "/api/ext/lordflix",
    path: "/api/ext/lordflix/api/movie/{id}?server=Lisbon&worker=1",
    tvPath: "/api/ext/lordflix/api/tv/{id}/{season}/{episode}?server=Lisbon&worker=1",
    responseType: "lordflix",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },
  
  // ── Kuro (Bingr Proxy API) ──
 // {
 //   name: "Kuro",
//    base: "/api/ext/bingr",
 //   path: "/api/ext/bingr/api/movie/{id}",
 //   tvPath: "/api/ext/bingr/api/tv/{id}/{season}/{episode}",
 //   responseType: "bingr",
//    quality: "1080p",
//    timeout: 15000,
//    mediaTypes: ["movie", "show"],
//  },

  // ── Tiki (Aether Serv-3) ──
//  {
//    name: "Tiki",
//    base: "/api/ext/aether",
//    path: "/api/ext/aether/api/movie/{id}?server=4",
//    tvPath: "/api/ext/aether/api/show/{id}/{season}/{episode}?server=4",
//    responseType: "aether_tiki",
//    timeout: 15000,
//    mediaTypes: ["movie", "show"],
//  },

  // ── Popins (OpStream API v2) ──
//  {
//    name: "Popins",
//    base: "/api/ext/opstream/api",
//    path: "/api/ext/opstream/api/movie/{id}",
//    tvPath: "/api/ext/opstream/api/tv/{id}/{season}/{episode}",
//    responseType: "url",
//    timeout: 15000,
//    mediaTypes: ["movie", "show"],
//  },

  // ── Meridian (Aether Serv-2) ──
//  {
//    name: "Meridian",
//    base: "/api/ext/aether",
//    path: "/api/ext/aether/api/movie/{id}?server=2",
//    tvPath: "/api/ext/aether/api/show/{id}/{season}/{episode}?server=2",
//    responseType: "aether_meridian",
 //   timeout: 15000,
 //   mediaTypes: ["movie", "show"],
//  },

  // ── CinetaroCDN ──
  {
    name: "CinetaroCDN",
    base: "/api/ext/cinetarocdn",
    path: "/api/ext/cinetarocdn/api/embek?tmdb_id={id}&type=movie",
    tvPath:
      "/api/ext/cinetarocdn/api/embek?tmdb_id={id}&type=tv&season={season}&episode={episode}",
    responseType: "qualities",
    quality: "AUTO",
    timeout: 15000,
    mediaTypes: ["movie", "show"],
  },
];

export default SERVERS;
