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
    | "bingr"
    | "url"
    | "lordflix"
    | "hable"
    | "movinight"
    | "xpass"
    | "vidfast"
    | "vidora";
  headers?: Record<string, string>;
  quality?: string;
}

const SERVERS: ServerConfig[] = [
  // ── ORIGINAL SERVER 1 ──
  // {
  //   name: "StreamVista",
  //   base: "https://streams.icefy.top",
  //   proxy: "https://weathered-a1ef.yilogag600-048.workers.dev",
  //   referer: true,
  //   timeout: 8000,
  //   responseType: "stream",
  // },

  // ── ORIGINAL SERVER 2 ──
  // {
  //   name: "CloudPlay",
  //   base: "https://tik-eather.yilogag600-048.workers.dev",
  //   timeout: 8000,
  //   responseType: "stream",
  // },

  // ── NEW: Pacific (server=1) ──
  // {
  //   name: "Pacific",
  //   base: "https://dulo.speedoflight.buzz",
  //   path: "https://dulo.speedoflight.buzz/api/movie/{id}?server=1",
  //   tvPath: "https://dulo.speedoflight.buzz/api/tv/{id}/{season}/{episode}?server=1",
  //   responseType: "source_object",
  //   streamProxy: "",
  //   quality: "1080p",
  //   timeout: 15000,
  // },

  // ── NEW: Orion (server=2) ──
  // {
  //   name: "Orion",
  //   base: "https://dulo.speedoflight.buzz",
  //   path: "https://dulo.speedoflight.buzz/api/movie/{id}?server=2",
  //   tvPath: "https://dulo.speedoflight.buzz/api/tv/{id}/{season}/{episode}?server=2",
  //   responseType: "source_object",
  //   streamProxy: "",
  //   quality: "1080p",
  //   timeout: 15000,
  // },

  // ── NEW: Nova (server=3) ──
  // {
  //   name: "Nova",
  //   base: "https://dulo.speedoflight.buzz",
  //   path: "https://dulo.speedoflight.buzz/api/movie/{id}?server=3",
  //   tvPath: "https://dulo.speedoflight.buzz/api/tv/{id}/{season}/{episode}?server=3",
  //   responseType: "source_object",
  //   streamProxy: "",
  //   quality: "1080p",
  //   timeout: 15000,
  // },

  // ── NEW: Hable (Vidrift) ──
  // {
  //   name: "Hable",
  //   base: "https://w7ooimb6vul9vcus77l7yf68.45.43.92.254.sslip.io",
  //   path: "https://w7ooimb6vul9vcus77l7yf68.45.43.92.254.sslip.io/api/movie/{id}",
  //   tvPath: "https://w7ooimb6vul9vcus77l7yf68.45.43.92.254.sslip.io/api/tv/{id}/{season}/{episode}",
  //   responseType: "url",
  //   timeout: 15000,
  // },

  // ── NEW: Vidfast vRapid (server=1) ──
  {
    name: "Vidfast",
    base: "https://vidfast.45.43.92.254.sslip.io",
    path: "https://vidfast.45.43.92.254.sslip.io/api/movie/{id}?server=1&worker=1&data=en",
    tvPath:
      "https://vidfast.45.43.92.254.sslip.io/api/tv/{id}/{season}/{episode}?server=1&worker=1&data=en",
    responseType: "vidfast",
    timeout: 15000,
  },

  // ── NEW: Vidfast vBlaze (server=2) ──
  {
    name: "Vidfast 2",
    base: "https://vidfast.45.43.92.254.sslip.io",
    path: "https://vidfast.45.43.92.254.sslip.io/api/movie/{id}?server=2&worker=1&data=en",
    tvPath:
      "https://vidfast.45.43.92.254.sslip.io/api/tv/{id}/{season}/{episode}?server=2&worker=1&data=en",
    responseType: "vidfast",
    timeout: 15000,
  },

  // ── NEW: Aether Serv-2 ──
  // {
  //   name: "Meriton",
  //   base: "https://aether-api.45.43.92.254.sslip.io",
  //   path: "https://aether-api.45.43.92.254.sslip.io/api/movie/{id}?server=1",
  //   tvPath: "https://aether-api.45.43.92.254.sslip.io/api/show/{id}/{season}/{episode}?server=1",
  //   responseType: "aether_meridian",
  //   timeout: 15000,
  // },

  // ── NEW: XPass ──
  {
    name: "XPass",
    base: "https://xpass-api.45.43.92.254.sslip.io",
    path: "https://xpass-api.45.43.92.254.sslip.io/movie/{id}?server=1&worker=1&data=en",
    tvPath:
      "https://xpass-api.45.43.92.254.sslip.io/tv/{id}/{season}/{episode}?server=1&worker=1&data=en",
    responseType: "xpass",
    timeout: 15000,
  },

  // ── NEW: Vidnest ──
  {
    name: "Vidnest",
    base: "https://upwvbg9nirhd0qn76tid7ces.45.43.92.254.sslip.io",
    path: "https://upwvbg9nirhd0qn76tid7ces.45.43.92.254.sslip.io/api/movie/{id}?data=en",
    tvPath:
      "https://upwvbg9nirhd0qn76tid7ces.45.43.92.254.sslip.io/api/tv/{id}/{season}/{episode}?data=en",
    responseType: "vidnest",
    quality: "1080p",
    timeout: 15000,
  },

  // ── NEW: VidRock Atlas (MP4 multi-quality) ──
  // {
  //   name: "Luna",
  //   base: "https://vidrock.speedoflight.buzz",
  //   path: "https://vidrock.speedoflight.buzz/api/movie/{id}?server=luna&worker=1",
  //   tvPath: "https://vidrock.speedoflight.buzz/api/tv/{id}/{season}/{episode}?server=luna&worker=1",
  //   responseType: "sources",
  //   quality: "1080p",
  //   timeout: 15000,
  // },

  // ── NEW: VidRock Atlas (HLS multi-quality) ──
  {
    name: "VidRock",
    base: "https://vidrock.speedoflight.buzz",
    path: "https://vidrock.speedoflight.buzz/api/movie/{id}?server=orion&worker=1&data=en",
    tvPath:
      "https://vidrock.speedoflight.buzz/api/tv/{id}/{season}/{episode}?server=orion&worker=1&data=en",
    responseType: "sources",
    quality: "1080p",
    timeout: 15000,
  },

  // ── NEW: Miami (Movy) ──
  {
    name: "Movy",
    base: "https://movy-bz.45.43.92.254.sslip.io",
    path: "https://movy-bz.45.43.92.254.sslip.io/api/movie/{id}?server=miami&worker=1&data=en",
    tvPath:
      "https://movy-bz.45.43.92.254.sslip.io/api/tv/{id}/{season}/{episode}?server=miami&worker=1&data=en",
    responseType: "lordflix",
    timeout: 15000,
  },

  // ── NEW: Vidora (Movies API) ──
  // { result, type, title, tmdb_id, sources: [{ file_code, url (m3u8), source, tracks: [{ label, file (vtt) }] }] }
  {
    name: "Vidora",
    base: "https://movies-api.45.43.92.254.sslip.io",
    path: "https://movies-api.45.43.92.254.sslip.io/api/movie/{id}?worker=1&data=en",
    tvPath:
      "https://movies-api.45.43.92.254.sslip.io/api/tv/{id}/{season}/{episode}?worker=1&data=en",
    responseType: "vidora",
    timeout: 15000,
  },

  // ── NEW: Lordflix (default) ──
  {
    name: "Lordflix",
    base: "https://lordflix.speedoflight.buzz",
    path: "https://lordflix.speedoflight.buzz/api/movie/{id}?server=Lisbon&worker=1&data=en",
    tvPath:
      "https://lordflix.speedoflight.buzz/api/tv/{id}/{season}/{episode}?server=Lisbon&worker=1&data=en",
    responseType: "lordflix",
    timeout: 15000,
  },

  // ── NEW: Lordflix (default) ──
  {
    name: "Lordflix Nebula",
    base: "https://lordflix.speedoflight.buzz",
    path: "https://lordflix.speedoflight.buzz/api/movie/{id}?server=nebula&worker=1&data=en",
    tvPath:
      "https://lordflix.speedoflight.buzz/api/tv/{id}/{season}/{episode}?server=nebula&worker=1&data=en",
    responseType: "lordflix",
    timeout: 15000,
  },

  // ── NEW: Lordflix (server=1 & worker=1) ──
  {
    name: "Lordflix Scout",
    base: "https://lordflix.speedoflight.buzz",
    path: "https://lordflix.speedoflight.buzz/api/movie/{id}?server=Scout&worker=1&data=en",
    tvPath:
      "https://lordflix.speedoflight.buzz/api/tv/{id}/{season}/{episode}?server=Scout&worker=1&data=en",
    responseType: "lordflix",
    timeout: 15000,
  },

  // ── NEW: CDN Cinetaro ──
  {
    name: "Cinetaro CDN",
    base: "https://atlantic.speedoflight.buzz",
    path: "https://atlantic.speedoflight.buzz/api/embek?tmdb_id={id}&type=movie",
    tvPath:
      "https://atlantic.speedoflight.buzz/api/embek?tmdb_id={id}&type=tv&season={season}&episode={episode}",
    responseType: "qualities",
    quality: "1080p",
    timeout: 15000,
  },

  // ── NEW: Kuro (Bingr Proxy API) ──
  // {
  //   name: "Kuro",
  //   base: "https://r420jyawtqacmm8bfuychtuv.45.43.92.254.sslip.io",
  //   path: "https://r420jyawtqacmm8bfuychtuv.45.43.92.254.sslip.io/api/movie/{id}",
  //   tvPath: "https://r420jyawtqacmm8bfuychtuv.45.43.92.254.sslip.io/api/tv/{id}/{season}/{episode}",
  //   responseType: "bingr",
  //   quality: "1080p",
  //   timeout: 15000,
  // },

  // ── NEW: Aether Serv-3 (Tiki) ──
  // {
  //   name: "Tiki",
  //   base: "https://aether-api.45.43.92.254.sslip.io",
  //   path: "https://aether-api.45.43.92.254.sslip.io/api/movie/{id}?server=4",
  //   tvPath: "https://aether-api.45.43.92.254.sslip.io/api/show/{id}/{season}/{episode}?server=4",
  //   responseType: "aether_tiki",
  //   timeout: 15000,
  // },

  // ── NEW: Popcorn (OpStream API v2) ──
  // {
  //   name: "Popins",
  //   base: "https://popcorn.speedoflight.buzz/api",
  //   path: "https://popcorn.speedoflight.buzz/api/movie/{id}",
  //   tvPath: "https://popcorn.speedoflight.buzz/api/tv/{id}/{season}/{episode}",
  //   responseType: "url",
  //   timeout: 15000,
  // },

  // ── NEW: Armor (OpStream API v2) ──
  // {
  //   name: "Armor",
  //   base: "https://opstream.speedoflight.buzz/api",
  //   path: "https://opstream.speedoflight.buzz/api/movie/{id}",
  //   tvPath: "https://opstream.speedoflight.buzz/api/tv/{id}/{season}/{episode}",
  //   responseType: "opstream",
  //   timeout: 15000,
  // },

  // ── NEW: MovieNest ──
  // {
  //   name: "MNest",
  //   base: "https://movienesttmdb.45.43.92.254.sslip.io",
  //   path: "https://movienesttmdb.45.43.92.254.sslip.io/movie/{id}",
  //   tvPath: "https://movienesttmdb.45.43.92.254.sslip.io/tv/{id}/{season}/{episode}",
  //   responseType: "streams",
  //   timeout: 12000,
  // },

  // ── NEW: 3rParty ──
  // {
  //   name: "Multi",
  //   base: "https://3rparty.45.43.92.254.sslip.io",
  //   path: "https://3rparty.45.43.92.254.sslip.io/movie/{id}",
  //   tvPath: "https://3rparty.45.43.92.254.sslip.io/tv/{id}/{season}/{episode}",
  //   responseType: "source_string", // ← new dedicated type
  //   timeout: 12000,
  // },

  // ── NEW: CDN Cinetaro ──
  // {
  //   name: "4K-CDN",
  //   base: "https://ombaaac9lhg997s2xgpk9yd3.45.43.92.254.sslip.io",
  //   path: "https://ombaaac9lhg997s2xgpk9yd3.45.43.92.254.sslip.io/api/movie/{id}",
  //   tvPath: "https://ombaaac9lhg997s2xgpk9yd3.45.43.92.254.sslip.io/api/tv/{id}/season/{season}/episode/{episode}",
  //   responseType: "streamUrl",
  //   timeout: 10000,
  // },
];

export default SERVERS;
