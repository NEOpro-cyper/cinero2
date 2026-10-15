/**
 * Public API for the customServers module.
 *
 * Other parts of the codebase should ONLY import from this file —
 * `config.ts`, `types.ts`, `adapters.ts`, `fetcher.ts` are internal.
 */

import type { MetaOutput } from "@movie-web/providers";

import SERVERS, { ServerConfig } from "./config";
import { scrapeCustomServer as doScrape } from "./fetcher";
import {
  CustomScrapeMedia,
  ScrapeCustomServerResult,
  playerMetaToCustomScrapeMedia,
} from "./types";

export { SERVERS };
export type { ServerConfig };
export type { CustomScrapeMedia, ScrapeCustomServerResult };

/** The synthetic source-id prefix for every custom server. */
export const CUSTOM_SERVER_ID_PREFIX = "custom-";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Construct the synthetic source-id for a given server config. */
export function customServerId(server: ServerConfig): string {
  return `${CUSTOM_SERVER_ID_PREFIX}${slugify(server.name)}`;
}

/** True if a source-id refers to a custom server. */
export function isCustomServerId(sourceId: string | null | undefined): boolean {
  return !!sourceId && sourceId.startsWith(CUSTOM_SERVER_ID_PREFIX);
}

/** Look up a ServerConfig by its synthetic source-id. */
export function getCustomServerById(
  sourceId: string | null | undefined,
): ServerConfig | undefined {
  if (!isCustomServerId(sourceId)) return undefined;
  return SERVERS.find((s) => customServerId(s) === sourceId);
}

/**
 * Build MetaOutput entries for every configured custom server, so they
 * appear alongside the bundled providers in the source picker UI.
 *
 * `mediaTypes` is sourced from each ServerConfig (defaulting to
 * ["movie", "show"] for TMDB-based servers). Miroru servers declare
 * ["anime"] so they only show up in the source picker for anime media
 * (URL pattern: /media/mal-<id>-<slug>).
 *
 * We use `unknown`-cast-safe construction because the exact MetaOutput
 * type from `@p-stream/providers` may have additional required fields
 * that aren't relevant for our custom servers (which bypass the
 * provider scraper entirely).
 */
export function getCustomServerMetaList(): MetaOutput[] {
  return SERVERS.map((s) => {
    const entry: Record<string, unknown> = {
      id: customServerId(s),
      type: "source",
      name: s.name,
      mediaTypes: s.mediaTypes ?? ["movie", "show"],
    };
    return entry as unknown as MetaOutput;
  });
}

/**
 * Scrape a custom server by its synthetic source-id, using a PlayerMeta.
 *
 * Returns a `ScrapeCustomServerResult` containing a `NormalizedStream`
 * that can be converted to a synthetic `RunOutput` upstream.
 */
export async function scrapeCustomServerByMeta(
  sourceId: string,
  meta: Parameters<typeof playerMetaToCustomScrapeMedia>[0],
): Promise<ScrapeCustomServerResult> {
  const server = getCustomServerById(sourceId);
  if (!server) throw new Error(`Unknown custom server: ${sourceId}`);
  const media = playerMetaToCustomScrapeMedia(meta);
  return doScrape(server, sourceId, media);
}

/**
 * Scrape a custom server by its synthetic source-id, using a raw
 * CustomScrapeMedia (used by the auto-scrape flow which already has
 * ScrapeMedia available).
 */
export async function scrapeCustomServerByMedia(
  sourceId: string,
  media: CustomScrapeMedia,
): Promise<ScrapeCustomServerResult> {
  const server = getCustomServerById(sourceId);
  if (!server) throw new Error(`Unknown custom server: ${sourceId}`);
  return doScrape(server, sourceId, media);
}
