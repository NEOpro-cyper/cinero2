import Fuse from "fuse.js";

import { MediaItem } from "@/utils/mediaTypes";

import {
  anilistIdToUrlId,
  searchAnime,
} from "./anilist";
import {
  formatTMDBMetaToMediaItem,
  formatTMDBSearchResult,
  getMediaDetails,
  getMediaPoster,
  isLikelyAnime,
  multiSearch,
} from "./tmdb";
import {
  TMDBContentTypes,
  TMDBMovieSearchResult,
  TMDBShowSearchResult,
} from "./types/tmdb";

export interface MWQuery {
  searchQuery: string;
}

// detect "tmdb:123456" or "tmdb:123456:movie" or "tmdb:123456:tv"
const tmdbIdPattern = /^tmdb:(\d+)(?::(movie|tv))?$/i;
const trailingYearPattern = /\s+\b(19|20)\d{2}\b$/;

// ── Persistent search cache ─────────────────────────────────────
//
// Search results are cached in TWO layers:
//   1. an in-memory Map (fast, per tab session), and
//   2. localStorage (survives page reloads and app restarts).
//
// Both share the same TTL (1 hour) and a bounded entry count so the
// storage never grows unbounded. Queries are normalized (trimmed +
// lowercased) so "One Piece", "one piece " and "One  piece" all hit
// the same entry.

const SEARCH_CACHE_STORAGE_KEY = "__MW::searchCache";
const SEARCH_CACHE_TTL_SECONDS = 3600; // 1 hour
const SEARCH_CACHE_MAX_ENTRIES = 60;

interface SearchCacheEntry {
  query: string; // normalized query (the map key too)
  results: MediaItem[];
  expiry: number; // epoch millis
}

interface MemoryEntry {
  results: MediaItem[];
  expiry: number; // epoch millis
}

function normalizeCacheQuery(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

class PersistentSearchCache {
  private memory = new Map<string, MemoryEntry>();

  private loaded = false;

  private storageAvailable(): boolean {
    try {
      return typeof window !== "undefined" && !!window.localStorage;
    } catch {
      return false;
    }
  }

  /** Load + prune entries from localStorage once per session. */
  private ensureLoaded(): void {
    if (this.loaded || !this.storageAvailable()) {
      this.loaded = true;
      return;
    }
    this.loaded = true;
    try {
      const raw = window.localStorage.getItem(SEARCH_CACHE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SearchCacheEntry[];
      if (!Array.isArray(parsed)) return;

      const now = Date.now();
      let changed = false;
      for (const entry of parsed) {
        if (!entry?.query || !Array.isArray(entry.results) || !entry.expiry) {
          changed = true; // malformed entry — drop it on next write
          continue;
        }
        if (entry.expiry <= now) {
          changed = true; // expired — drop it
          continue;
        }
        this.memory.set(entry.query, {
          results: entry.results,
          expiry: entry.expiry,
        });
      }
      if (changed) this.persist();
    } catch (err) {
      console.warn("Search cache: failed to read persisted cache:", err);
    }
  }

  /** Write the in-memory map back to localStorage (bounded + pruned). */
  private persist(): void {
    if (!this.storageAvailable()) return;
    try {
      const now = Date.now();
      const entries: SearchCacheEntry[] = [];
      for (const [query, entry] of this.memory) {
        if (entry.expiry <= now) continue; // drop expired on write
        entries.push({ query, results: entry.results, expiry: entry.expiry });
      }

      // When over the cap, drop the OLDEST entries by evicting from the
      // front of the insertion-ordered map before writing.
      while (entries.length > SEARCH_CACHE_MAX_ENTRIES) {
        const oldestKey = this.memory.keys().next().value as string;
        this.memory.delete(oldestKey);
        entries.shift();
      }

      window.localStorage.setItem(
        SEARCH_CACHE_STORAGE_KEY,
        JSON.stringify(entries),
      );
    } catch (err) {
      // Quota exceeded / private mode — cache is best-effort.
      console.warn("Search cache: failed to persist cache:", err);
    }
  }

  get(searchQuery: string): MediaItem[] | undefined {
    this.ensureLoaded();
    const key = normalizeCacheQuery(searchQuery);
    const hit = this.memory.get(key);
    if (!hit) return undefined;
    // Honor the per-entry TTL — a long-lived tab must not serve stale
    // results forever.
    if (hit.expiry <= Date.now()) {
      this.memory.delete(key);
      this.persist();
      return undefined;
    }
    // Touch the entry so it moves to the back of the eviction order.
    this.memory.delete(key);
    this.memory.set(key, hit);
    return hit.results;
  }

  set(searchQuery: string, results: MediaItem[]): void {
    this.ensureLoaded();
    const key = normalizeCacheQuery(searchQuery);
    this.memory.set(key, {
      results,
      expiry: Date.now() + SEARCH_CACHE_TTL_SECONDS * 1000,
    });
    this.persist();
  }

  clear(): void {
    this.memory.clear();
    if (this.storageAvailable()) {
      try {
        window.localStorage.removeItem(SEARCH_CACHE_STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  }
}

const searchCache = new PersistentSearchCache();

function normalizeQuery(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getLenientQueries(searchQuery: string): string[] {
  const base = searchQuery.trim();
  if (base.length < 3) return [base];

  const normalized = normalizeQuery(base);
  const withoutTrailingYear = base.replace(trailingYearPattern, "").trim();
  const normalizedWithoutYear = normalizeQuery(withoutTrailingYear);

  const variants = [
    ...new Set([base, normalized, withoutTrailingYear, normalizedWithoutYear]),
  ].filter((q) => q.length > 0);

  // Keep fanout small to avoid TMDB rate-limit pressure.
  return variants.slice(0, 2);
}

function dedupeTMDBResults(
  items: (TMDBMovieSearchResult | TMDBShowSearchResult)[],
): (TMDBMovieSearchResult | TMDBShowSearchResult)[] {
  const deduped = new Map<
    string,
    TMDBMovieSearchResult | TMDBShowSearchResult
  >();

  items.forEach((item) => {
    deduped.set(`${item.media_type}:${item.id}`, item);
  });

  return Array.from(deduped.values());
}

function rankTMDBResultsFuzzy(
  items: (TMDBMovieSearchResult | TMDBShowSearchResult)[],
  query: string,
): (TMDBMovieSearchResult | TMDBShowSearchResult)[] {
  if (items.length <= 1) return items;

  const fuse = new Fuse(items, {
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.45,
    minMatchCharLength: 2,
    keys: [
      { name: "title", weight: 0.6 },
      { name: "name", weight: 0.6 },
      { name: "original_title", weight: 0.2 },
      { name: "original_name", weight: 0.2 },
    ],
  });

  const ranked = fuse.search(query).map((result) => result.item);
  const rankedSet = new Set(
    ranked.map((item) => `${item.media_type}:${item.id}`),
  );
  const remainder = items.filter(
    (item) => !rankedSet.has(`${item.media_type}:${item.id}`),
  );

  return ranked.concat(remainder);
}

export async function searchForMedia(query: MWQuery): Promise<MediaItem[]> {
  // Layer 1 + 2: memory and localStorage cache (1 hour TTL).
  const cached = searchCache.get(query.searchQuery);
  if (cached) return cached;

  const { searchQuery } = query;

  // Check if query is a TMDB ID
  const tmdbMatch = searchQuery.match(tmdbIdPattern);
  if (tmdbMatch) {
    const id = tmdbMatch[1];
    const type =
      tmdbMatch[2]?.toLowerCase() === "tv"
        ? TMDBContentTypes.TV
        : TMDBContentTypes.MOVIE;

    try {
      const details = await getMediaDetails(id, type);
      if (details) {
        // Format the media details to our common format
        const mediaResult =
          type === TMDBContentTypes.MOVIE
            ? {
                id: details.id,
                title: (details as any).title,
                poster: getMediaPoster((details as any).poster_path),
                object_type: type,
                original_release_date: new Date((details as any).release_date),
              }
            : {
                id: details.id,
                title: (details as any).name,
                poster: getMediaPoster((details as any).poster_path),
                object_type: type,
                original_release_date: new Date(
                  (details as any).first_air_date,
                ),
              };

        const mediaItem = formatTMDBMetaToMediaItem(mediaResult);
        const result = [mediaItem];
        searchCache.set(query.searchQuery, result);
        return result;
      }
    } catch (error) {
      console.error("Error fetching by TMDB ID:", error);
    }
  }

  const queryVariants = getLenientQueries(searchQuery);
  // Kick off the AniList anime search FIRST so it runs in parallel with
  // the TMDB multi-search below. Its failures are contained here (empty
  // result set) and observed when awaited further down.
  const animeSearchPromise = searchAnime(searchQuery, 1, 20).catch(
    (err: unknown) => {
      console.error("AniList anime search failed:", err);
      return { results: [], hasNext: false };
    },
  );

  const settledResults = await Promise.allSettled(
    queryVariants.map((q) => multiSearch(q)),
  );
  const fulfilledResults = settledResults
    .filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        (TMDBMovieSearchResult | TMDBShowSearchResult)[]
      > => result.status === "fulfilled",
    )
    .map((result) => result.value);

  // TMDB entirely failed — still merge the AniList anime results so
  // anime search keeps working when TMDB is down.
  const tmdbItems: MediaItem[] =
    fulfilledResults.length === 0
      ? []
      : (() => {
          const data = dedupeTMDBResults(fulfilledResults.flat());
          // Filter ALL Japanese/Chinese/Korean-origin animation (anime,
          // donghua, aeni) out of the TMDB results — TMDB serves
          // live-action movies/series only. Anime is served EXCLUSIVELY
          // by AniList (see ./anilist.ts) so the two sources never
          // duplicate or overlap.
          const nonAnimeData = data.filter((item) => !isLikelyAnime(item));
          const rankedData = rankTMDBResultsFuzzy(nonAnimeData, searchQuery);

          return rankedData.map((v) => {
            const formattedResult = formatTMDBSearchResult(v, v.media_type);
            return formatTMDBMetaToMediaItem(formattedResult);
          });
        })();

  // Merge anime fetched DIRECTLY from AniList (GraphQL) — TMDB handles
  // movies/series, AniList handles 100% of the anime. Results are
  // AniList-native URL ids ("anilist-{id}-{slug}").
  const { results: animeResults } = await animeSearchPromise;
  const animeItems: MediaItem[] = animeResults.map((a) => ({
    id: anilistIdToUrlId(a.id, a.title),
    title: a.title,
    year: a.year,
    poster: a.poster,
    type: "show", // anime episodes are surfaced as a show in the UI
  }));

  const combined = tmdbItems.concat(animeItems);
  const movieWithPosters = combined.filter((movie) => movie.poster);
  const movieWithoutPosters = combined.filter((movie) => !movie.poster);

  const sortedresult = movieWithPosters.concat(movieWithoutPosters);

  // cache results (memory + localStorage) for 1 hour
  searchCache.set(query.searchQuery, sortedresult);
  return sortedresult;
}
