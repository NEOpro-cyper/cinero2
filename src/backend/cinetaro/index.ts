import {
  type MovieScrapeContext,
  NotFoundError,
  type ShowScrapeContext,
  type SourcererOutput,
  flags,
} from "@movie-web/providers";

import { parseByResponseType } from "./scrape";
import SERVERS, { type ServerConfig } from "./servers";

// `Sourcerer` is internal to @movie-web/providers, but its building block
// `SourcererOptions` is exported. We re-declare the full shape locally so
// the rest of this file can keep its typed source-builder API.
type Sourcerer = import("@movie-web/providers").SourcererOptions & {
  type: "source";
  disabled: boolean;
  mediaTypes: ("show" | "movie")[];
};

// ───────────────────────────────────────────────────────────────
// URL building
// ───────────────────────────────────────────────────────────────

function buildUrl(
  template: string,
  vars: { id: string; season?: number; episode?: number },
): string {
  let out = template;
  out = out.replace(/\{id\}/g, encodeURIComponent(String(vars.id)));
  out = out.replace(/\{season\}/g, String(vars.season ?? 1));
  out = out.replace(/\{episode\}/g, String(vars.episode ?? 1));
  return out;
}

function defaultMoviePath(server: ServerConfig): string {
  if (server.path) return server.path;
  return `${server.base.replace(/\/$/, "")}/movie/{id}`;
}

function defaultTvPath(server: ServerConfig): string {
  if (server.tvPath) return server.tvPath;
  return `${server.base.replace(/\/$/, "")}/tv/{id}/{season}/{episode}`;
}

// ───────────────────────────────────────────────────────────────
// Fetch + parse
// ───────────────────────────────────────────────────────────────

async function fetchServer(
  server: ServerConfig,
  url: string,
  fetcher: (url: string, opts?: any) => Promise<any>,
): Promise<any> {
  const timeout = server.timeout ?? 12000;
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    ...(server.headers || {}),
  };
  if (server.referer && server.base) {
    try {
      const u = new URL(server.base);
      headers.Referer = `${u.origin}/`;
    } catch {
      // ignore
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    // The movie-web UseableFetcher accepts (url, opts) and returns parsed body directly
    const result = await fetcher(url, {
      method: "GET",
      headers,
      query: {},
      readHeaders: [],
    });
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function scrapeServer(
  server: ServerConfig,
  isShow: boolean,
  media: {
    tmdbId: string;
    season?: { number: number };
    episode?: { number: number };
  },
  fetcher: (url: string, opts?: any) => Promise<any>,
): Promise<SourcererOutput> {
  const template = isShow ? defaultTvPath(server) : defaultMoviePath(server);
  const url = buildUrl(template, {
    id: media.tmdbId,
    season: media.season?.number,
    episode: media.episode?.number,
  });

  let data: any;
  try {
    data = await fetchServer(server, url, fetcher);
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new NotFoundError(
        `${server.name} timeout after ${server.timeout ?? 12000}ms`,
      );
    }
    throw err;
  }

  // Some APIs return string bodies - try to parse
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      // keep as string for source_string parser
    }
  }

  const streams = parseByResponseType(data, server);
  if (streams.length === 0) {
    throw new NotFoundError(`${server.name} returned no streams`);
  }
  return { embeds: [], stream: streams };
}

// ───────────────────────────────────────────────────────────────
// Build a Sourcerer for each server in SERVERS
// ───────────────────────────────────────────────────────────────

export function makeCinetaroSource(
  server: ServerConfig,
  index: number,
): Sourcerer {
  const id = `cinetaro-${index}-${server.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const source: Sourcerer = {
    id,
    name: server.name,
    type: "source",
    rank: 100 + index,
    disabled: !server.responseType,
    mediaTypes: ["show", "movie"],
    flags: [flags.CORS_ALLOWED],
    async scrapeMovie(input: MovieScrapeContext): Promise<SourcererOutput> {
      return scrapeServer(
        server,
        false,
        { tmdbId: input.media.tmdbId },
        input.fetcher,
      );
    },
    async scrapeShow(input: ShowScrapeContext): Promise<SourcererOutput> {
      return scrapeServer(
        server,
        true,
        {
          tmdbId: input.media.tmdbId,
          season: input.media.season,
          episode: input.media.episode,
        },
        input.fetcher,
      );
    },
  };
  return source;
}

export function getCinetaroSources(): Sourcerer[] {
  return SERVERS.map((server, idx) => makeCinetaroSource(server, idx));
}

export { SERVERS };
export type { ServerConfig };
