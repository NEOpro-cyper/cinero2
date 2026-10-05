/**
 * Internal types for the customServers module.
 *
 * A NormalizedStream is the common shape that every per-responseType
 * adapter must produce. The fetcher then converts it into a synthetic
 * `RunOutput` that the rest of the P-Stream player pipeline can consume
 * (see `convertRunoutputToSource` and `convertProviderCaption`).
 */

import type { PlayerMeta } from "@/stores/player/slices/source";

export type CustomMediaType = "movie" | "show" | "anime";

export interface CustomScrapeMedia {
  type: CustomMediaType;
  tmdbId: string;
  imdbId?: string;
  title: string;
  releaseYear: number;
  season?: { number: number; tmdbId: string; title: string };
  episode?: { number: number; tmdbId: string; title: string };
  /** MyAnimeList (MAL) anime ID — only set for anime media. Used by the
   *  Zoko anime server to build URLs like
   *  /api/mal/{sub|dub}/{malId}/{episode}?worker=1.
   *  For non-anime media this is undefined and Zoko is skipped. */
  malId?: number;
  /** Stream category — "sub" or "dub". Only used by the Zoko anime
   *  server. Defaults to "sub". Read from preferences. */
  miroruCategory?: "sub" | "dub";
}

/** A single normalized subtitle/caption entry. */
export interface NormalizedCaption {
  id: string;
  language: string;
  url: string;
  hasCorsRestrictions?: boolean;
  type?: string;
  display?: string;
  /** Source API marked this as the default subtitle track. */
  isDefault?: boolean;
}

/** A single normalized quality variant of a file (mp4) stream. */
export interface NormalizedFileQuality {
  quality: string; // "1080", "720", "480", "4k", "unknown"
  url: string;
  type: "mp4";
}

/**
 * The normalized stream. Either:
 *   - type "hls"  → a single HLS playlist URL (+ optional headers + captions)
 *   - type "file" → one or more MP4 URLs keyed by quality (+ optional captions)
 */
export interface NormalizedStream {
  type: "hls" | "file";
  /** HLS playlist URL when type === "hls" */
  url?: string;
  /** MP4 quality variants when type === "file" */
  qualities?: NormalizedFileQuality[];
  /** HTTP headers required by the player when fetching the stream */
  headers?: Record<string, string>;
  /** Same as `headers`, but used as a hint for the player (not enforced) */
  preferredHeaders?: Record<string, string>;
  /** Optional list of captions/subtitles */
  captions: NormalizedCaption[];
  /** Optional display name for the picked source (used in logs / UI) */
  label?: string;
}

export interface ScrapeCustomServerResult {
  /** The synthetic source ID (e.g. "custom-armor") — used by player state */
  sourceId: string;
  /** Display name of the server */
  sourceName: string;
  /** Normalized stream consumed by the player pipeline */
  stream: NormalizedStream;
}

/** Convert a PlayerMeta (from the player store) into a CustomScrapeMedia. */
export function playerMetaToCustomScrapeMedia(
  meta: PlayerMeta,
): CustomScrapeMedia {
  if (meta.type === "show") {
    if (!meta.episode || !meta.season) {
      throw new Error("missing show data for custom scrape");
    }
    return {
      type: "show",
      tmdbId: meta.tmdbId,
      imdbId: meta.imdbId,
      title: meta.title,
      releaseYear: meta.releaseYear,
      season: {
        number: meta.season.number,
        tmdbId: meta.season.tmdbId,
        title: meta.season.title,
      },
      episode: {
        number: meta.episode.number,
        tmdbId: meta.episode.tmdbId,
        title: meta.episode.title,
      },
      malId: meta.malId,
      miroruCategory: meta.miroruCategory,
    };
  }
  return {
    type: meta.malId ? "anime" : "movie",
    tmdbId: meta.tmdbId,
    imdbId: meta.imdbId,
    title: meta.title,
    releaseYear: meta.releaseYear,
    malId: meta.malId,
    miroruCategory: meta.miroruCategory,
  };
}
