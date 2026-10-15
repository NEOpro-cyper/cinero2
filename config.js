// ════════════════════════════════════════════════════════════════
//  P-Stream RUNTIME configuration
//  ───────────────────────────────────────────────────────────────
//  This file is loaded by the browser at runtime (NOT at build time).
//  It overrides any VITE_* env vars set during the build.
//
//  In Docker deployments, mount this file as a volume:
//    volumes:
//      - ./config.js:/usr/share/nginx/html/config.js
//
//  In Vercel / Netlify deployments, you can either:
//    (a) build with the right VITE_* env vars, OR
//    (b) edit this file in the `public/` directory before building
//
//  The most important fields to set are:
//    - VITE_TMDB_READ_API_KEY
//    - VITE_CORS_PROXY_URL  (needed for in-browser HLS playback of
//                            cross-origin streams)
// ════════════════════════════════════════════════════════════════

window.__CONFIG__ = {
  // The Discord invite URL used by the "Join Discord" button (player
  // error screen), the navigation header, the footer, and the support
  // page. Edit this to point to your own Discord server.
  VITE_DISCORD_LINK: "",

  // The URL for the CORS proxy. The URL must NOT end with a slash
  // (unless you're using a path-style proxy like `?url=`).
  // Examples:
  //   "https://corsproxy.io/?url="           (encoded URL appended)
  //   "https://my-proxy.workers.dev/?url="   (encoded URL appended)
  //   "https://my-proxy.workers.dev/"        (raw URL appended)
  // If left empty, the onboarding will require the user to install
  // the browser extension or set up their own proxy.
  VITE_CORS_PROXY_URL: "",

  // The M3U8 proxy URL (for HLS streams). Same rules as above.
  VITE_M3U8_PROXY_URL: "",

  // The READ API key for TMDB. Get one at https://www.themoviedb.org/settings/api
  VITE_TMDB_READ_API_KEY: "61e2290429798c561450eb56b26de19b",

  // DMCA email shown in the footer (null to hide the DMCA link).
  VITE_DMCA_EMAIL: null,

  // Use browser History API routing (true) or hash-based routing (false).
  // For Vercel / nginx / Netlify, leave this as `true`.
  VITE_NORMAL_ROUTER: true,

  // Backend URL(s) for the accounts/server sync feature.
  // Leave null to disable the accounts feature entirely.
  // Can be a single URL or comma-separated list.
  VITE_BACKEND_URL: null,

  // Comma-separated list of disallowed IDs in case of a DMCA claim.
  // Format: "series-<id>" or "movie-<id>".
  VITE_DISALLOWED_IDS: "",

  // ── Ads ──────────────────────────────────────────────────────────
  // Show the banner ad on the home page (true / false).
  VITE_SHOW_AD: false,

  // Banner ad content. Array of strings, comma-separated in config.js:
  //   [0] = card message above banner (or "null" to hide)
  //   [1] = ad 1 click URL
  //   [2] = ad 1 image URL
  //   [3] = ad 1 caption text
  //   [4] = ad 2 click URL
  //   [5] = ad 2 image URL
  //   [6] = ad 2 caption text
  VITE_AD_CONTENT_URL: "",

  // Script-injected ad slots. Each entry becomes a toggleable ad slot
  // in Settings → Ads. Format: "name1|url1,name2|url2,..."
  //
  // You can also paste bare <script src=...></script> tags separated by
  // commas — the parser extracts the src URL automatically.
  //
  // Example:
  //   VITE_AD_SCRIPTS: "terra|https://downyattainprojects.com/8e/b8/32/8eb832d6881025820b70493d89bee8ae.js,tag|https://another.example/path.js"
  VITE_AD_SCRIPTS: "",
};
