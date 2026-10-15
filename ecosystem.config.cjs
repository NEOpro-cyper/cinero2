module.exports = {
  apps: [
    {
      name: "p-stream",
      script: "server.js",
      cwd: "/home/z/my-project/pstream-deploy/pstream24",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOST: "0.0.0.0",
        // Anime metadata is fetched DIRECTLY from AniList (graphql.anilist.co)
        // in the browser — the old Jikan/MAL proxy env vars are gone.
        // Optional generic rotating-proxy tunnel for rate-limited upstreams:
        // ROTATING_PROXY_URL: "http://user:pass@host:port",
        // Redis cache (only used by proxy routes that set cacheTtl —
        // none do by default; anime metadata is cached client-side).
        REDIS_URL: "redis://default:anilist24@r5q1yih3k7bih9kdnps5yk8k:6379/0",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 5,
    },
  ],
};
