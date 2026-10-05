/**
 * ══════════════════════════════════════════════════════════════
 *  ANILIST API INTEGRATION — the ONLY anime metadata source
 * ══════════════════════════════════════════════════════════════
 *
 *  ALL anime metadata (search, trending, popular, airing, upcoming,
 *  top-rated, details) is fetched EXCLUSIVELY from AniList's GraphQL
 *  API. The old Jikan (MyAnimeList) and official-MAL integrations
 *  have been removed — no anime metadata ever touches Jikan/MAL.
 *
 *  • AniList GraphQL endpoint: https://graphql.anilist.co
 *    Fetched DIRECTLY from the browser (AniList fully supports CORS).
 *  • Rate limit: ~30 req/min per IP — handled by the 1-hour response
 *    cache below plus the persistent search cache (see search.ts).
 *  • Legacy URL support: old "mal-{id}-{slug}" links (bookmarks,
 *    continue-watching entries) are still resolved — but through
 *    AniList's `Media(idMal:)` lookup, NOT through any MAL API.
 *
 *  ID scheme: media URL ids look like "anilist-21-one-piece".
 * ══════════════════════════════════════════════════════════════
 */

import { SimpleCache } from "@/utils/cache";

import { MWMediaMeta, MWMediaType } from "./types/mw";

// ── AniList base URL — DIRECT ──
// Anime data is fetched straight from AniList's public GraphQL API.
// graphql.anilist.co fully supports CORS, so no server-side proxy is
// needed (the old /api/ext/anilist/* and /api/ext/jikan/* proxies are
// gone along with the Jikan/MAL integrations).
const ANILIST_BASE = "https://graphql.anilist.co";

// Shared field list for the full anime-details query. Used by BOTH
// getAnimeDetails() (by AniList id) and getAnimeDetailsByMalId()
// (legacy mal- URLs, resolved via AniList's idMal index).
const ANIME_DETAILS_FIELDS = `
  id
  idMal
  title { romaji english native userPreferred }
  type
  format
  status
  description
  startDate { year month day }
  endDate { year month day }
  episodes
  duration
  genres
  synonyms
  averageScore
  meanScore
  popularity
  trending
  favourites
  siteUrl
  coverImage { extraLarge large medium color }
  bannerImage
  nextAiringEpisode { airingAt timeUntilAiring episode }
  studios { nodes { name isAnimationStudio } }
  relations {
    edges { relationType node { id title { romaji english native } type format coverImage { large } } }
  }
  recommendations {
    nodes { mediaRecommendation { id title { romaji english native } coverImage { large } averageScore } rating }
  }
`;

// ── Types ──

export interface AniListMedia {
  id: number;
  idMal: number | null;
  title: {
    romaji: string | null;
    english: string | null;
    native: string | null;
    userPreferred: string | null;
  };
  type: "ANIME" | "MANGA";
  format: string | null;
  status: string | null;
  description: string | null;
  startDate: { year: number | null; month: number | null; day: number | null };
  endDate: { year: number | null; month: number | null; day: number | null };
  episodes: number | null;
  duration: number | null;
  genres: string[];
  synonyms: string[];
  averageScore: number | null;
  meanScore: number | null;
  popularity: number | null;
  trending: number | null;
  favourites: number | null;
  siteUrl: string | null;
  coverImage: {
    extraLarge: string | null;
    large: string | null;
    medium: string | null;
    color: string | null;
  };
  bannerImage: string | null;
  nextAiringEpisode: {
    airingAt: number | null;
    timeUntilAiring: number | null;
    episode: number | null;
  } | null;
  studios: { nodes: { name: string; isAnimationStudio: boolean }[] };
  relations: {
    edges: {
      relationType: string;
      node: AniListMedia;
    }[];
  };
  recommendations: {
    nodes: {
      mediaRecommendation: AniListMedia;
      rating: number;
    }[];
  };
}

export interface AniListSearchResult {
  id: number;
  title: string;
  poster: string | undefined;
  type: MWMediaType;
  year: number | undefined;
  episodes: number | null;
  score: number | null;
  format: string | null;
}

// ── Cache ──

const anilistCache = new SimpleCache<{ key: string }, any>();
anilistCache.setCompare((a, b) => a.key === b.key);
anilistCache.initialize();

// ── GraphQL fetch helper ──

async function anilistFetch<T = any>(
  query: string,
  variables: Record<string, any> = {},
): Promise<T> {
  const cacheKey = { key: `anilist:${query}:${JSON.stringify(variables)}` };
  const cached = anilistCache.get(cacheKey);
  if (cached) return cached as T;

  const body = JSON.stringify({ query, variables });

  try {
    const res = await fetch(ANILIST_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(
        `AniList API error ${res.status}: ${errorText.slice(0, 200)}`,
      );
    }

    const json = await res.json();

    if (json.errors?.length) {
      throw new Error(
        `AniList GraphQL error: ${json.errors[0]?.message ?? "unknown"}`,
      );
    }

    const result = json.data as T;
    anilistCache.set(cacheKey, result, 3600); // 1 hour cache
    return result;
  } catch (err) {
    console.error("AniList fetch failed:", err);
    throw err;
  }
}

// ── Search ──

export async function searchAnime(
  searchQuery: string,
  page: number = 1,
  perPage: number = 20,
): Promise<{ results: AniListSearchResult[]; hasNext: boolean }> {
  const query = `
    query ($search: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        media(search: $search, type: ANIME, isAdult: false, sort: [SEARCH_MATCH, POPULARITY_DESC]) {
          id
          idMal
          title { romaji english native userPreferred }
          type
          format
          episodes
          averageScore
          startDate { year }
          coverImage { large }
        }
      }
    }
  `;

  const data = await anilistFetch<{
    Page: {
      pageInfo: { hasNextPage: boolean };
      media: AniListMedia[];
    };
  }>(query, { search: searchQuery, page, perPage });

  const results: AniListSearchResult[] = (data.Page.media ?? []).map((m) => ({
    id: m.id,
    title: m.title.english ?? m.title.romaji ?? m.title.native ?? "Unknown",
    poster: m.coverImage.large ?? undefined,
    type: MWMediaType.ANIME,
    year: m.startDate.year ?? undefined,
    episodes: m.episodes,
    score: m.averageScore,
    format: m.format,
  }));

  return { results, hasNext: data.Page.pageInfo.hasNextPage };
}

// ── Trending / Popular ──

export async function getTrendingAnime(
  page: number = 1,
  perPage: number = 30,
): Promise<AniListSearchResult[]> {
  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(type: ANIME, sort: TRENDING_DESC, isAdult: false) {
          id
          title { romaji english native userPreferred }
          type
          format
          episodes
          averageScore
          startDate { year }
          coverImage { large }
        }
      }
    }
  `;

  const data = await anilistFetch<{
    Page: { media: AniListMedia[] };
  }>(query, { page, perPage });

  return (data.Page.media ?? []).map((m) => ({
    id: m.id,
    title: m.title.english ?? m.title.romaji ?? m.title.native ?? "Unknown",
    poster: m.coverImage.large ?? undefined,
    type: MWMediaType.ANIME,
    year: m.startDate.year ?? undefined,
    episodes: m.episodes,
    score: m.averageScore,
    format: m.format,
  }));
}

export async function getPopularAnime(
  page: number = 1,
  perPage: number = 30,
): Promise<AniListSearchResult[]> {
  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
          id
          title { romaji english native userPreferred }
          type
          format
          episodes
          averageScore
          startDate { year }
          coverImage { large }
        }
      }
    }
  `;

  const data = await anilistFetch<{
    Page: { media: AniListMedia[] };
  }>(query, { page, perPage });

  return (data.Page.media ?? []).map((m) => ({
    id: m.id,
    title: m.title.english ?? m.title.romaji ?? m.title.native ?? "Unknown",
    poster: m.coverImage.large ?? undefined,
    type: MWMediaType.ANIME,
    year: m.startDate.year ?? undefined,
    episodes: m.episodes,
    score: m.averageScore,
    format: m.format,
  }));
}

// ── Currently Airing (this season) ──

export async function getAiringAnime(
  page: number = 1,
  perPage: number = 30,
): Promise<AniListSearchResult[]> {
  // NOTE: AniList's `media` field on `Page` does NOT support a `nextAiringEpisode_not_null`
  // argument (it returns HTTP 400 "Unknown argument"). We instead filter by
  // `status: RELEASING` and drop entries without a `nextAiringEpisode` client-side.
  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(type: ANIME, status: RELEASING, isAdult: false, sort: POPULARITY_DESC) {
          id
          title { romaji english native userPreferred }
          type
          format
          episodes
          averageScore
          startDate { year }
          coverImage { large }
          nextAiringEpisode { airingAt episode }
        }
      }
    }
  `;

  const data = await anilistFetch<{
    Page: { media: AniListMedia[] };
  }>(query, { page, perPage });

  // Filter to only those that actually have a next airing episode scheduled
  return (data.Page.media ?? [])
    .filter((m) => m.nextAiringEpisode && m.nextAiringEpisode.airingAt != null)
    .map((m) => ({
      id: m.id,
      title: m.title.english ?? m.title.romaji ?? m.title.native ?? "Unknown",
      poster: m.coverImage.large ?? undefined,
      type: MWMediaType.ANIME,
      year: m.startDate.year ?? undefined,
      episodes: m.episodes,
      score: m.averageScore,
      format: m.format,
    }));
}

// ── Upcoming Next Season ──

export async function getUpcomingAnime(
  page: number = 1,
  perPage: number = 30,
): Promise<AniListSearchResult[]> {
  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(type: ANIME, status: NOT_YET_RELEASED, isAdult: false, sort: POPULARITY_DESC) {
          id
          title { romaji english native userPreferred }
          type
          format
          episodes
          averageScore
          startDate { year }
          coverImage { large }
        }
      }
    }
  `;

  const data = await anilistFetch<{
    Page: { media: AniListMedia[] };
  }>(query, { page, perPage });

  return (data.Page.media ?? []).map((m) => ({
    id: m.id,
    title: m.title.english ?? m.title.romaji ?? m.title.native ?? "Unknown",
    poster: m.coverImage.large ?? undefined,
    type: MWMediaType.ANIME,
    year: m.startDate.year ?? undefined,
    episodes: m.episodes,
    score: m.averageScore,
    format: m.format,
  }));
}

// ── Top Rated Anime ──

export async function getTopRatedAnime(
  page: number = 1,
  perPage: number = 30,
): Promise<AniListSearchResult[]> {
  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(type: ANIME, sort: SCORE_DESC, isAdult: false) {
          id
          title { romaji english native userPreferred }
          type
          format
          episodes
          averageScore
          startDate { year }
          coverImage { large }
        }
      }
    }
  `;

  const data = await anilistFetch<{
    Page: { media: AniListMedia[] };
  }>(query, { page, perPage });

  return (data.Page.media ?? []).map((m) => ({
    id: m.id,
    title: m.title.english ?? m.title.romaji ?? m.title.native ?? "Unknown",
    poster: m.coverImage.large ?? undefined,
    type: MWMediaType.ANIME,
    year: m.startDate.year ?? undefined,
    episodes: m.episodes,
    score: m.averageScore,
    format: m.format,
  }));
}

// ── All-time Popular Anime ──

export async function getAllTimePopularAnime(
  page: number = 1,
  perPage: number = 30,
): Promise<AniListSearchResult[]> {
  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(type: ANIME, sort: FAVOURITES_DESC, isAdult: false) {
          id
          title { romaji english native userPreferred }
          type
          format
          episodes
          averageScore
          startDate { year }
          coverImage { large }
        }
      }
    }
  `;

  const data = await anilistFetch<{
    Page: { media: AniListMedia[] };
  }>(query, { page, perPage });

  return (data.Page.media ?? []).map((m) => ({
    id: m.id,
    title: m.title.english ?? m.title.romaji ?? m.title.native ?? "Unknown",
    poster: m.coverImage.large ?? undefined,
    type: MWMediaType.ANIME,
    year: m.startDate.year ?? undefined,
    episodes: m.episodes,
    score: m.averageScore,
    format: m.format,
  }));
}

// ── Details ──

export async function getAnimeDetails(
  anilistId: number,
): Promise<AniListMedia | null> {
  const query = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        ${ANIME_DETAILS_FIELDS}
      }
    }
  `;

  const data = await anilistFetch<{ Media: AniListMedia | null }>(query, {
    id: anilistId,
  });
  return data.Media;
}

/**
 * Resolve a LEGACY MAL id (from old "mal-{id}-{slug}" URLs, bookmarks
 * and progress entries) to its AniList media entry.
 *
 * This goes through AniList's own `Media(idMal:)` index — the MAL API
 * is NEVER called. Old links keep working while every byte of metadata
 * still comes from AniList.
 */
export async function getAnimeDetailsByMalId(
  malId: number,
): Promise<AniListMedia | null> {
  const query = `
    query ($idMal: Int) {
      Media(idMal: $idMal, type: ANIME) {
        ${ANIME_DETAILS_FIELDS}
      }
    }
  `;

  const data = await anilistFetch<{ Media: AniListMedia | null }>(query, {
    idMal: malId,
  });
  return data.Media;
}

// ── ID encoding/decoding ──

/** Encode an AniList ID into a URL-safe media ID: "anilist-{id}-{slug}" */
export function anilistIdToUrlId(anilistId: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `anilist-${anilistId}-${slug}`;
}

/** Decode a URL media ID back to an AniList ID. Returns null if not an AniList ID. */
export function decodeAnilistId(
  paramId: string,
): { id: number; type: MWMediaType } | null {
  const [prefix, idStr] = paramId.split("-", 2);
  if (prefix !== "anilist") return null;
  const id = parseInt(idStr, 10);
  if (Number.isNaN(id)) return null;
  return { id, type: MWMediaType.ANIME };
}

/** Check if a URL media ID is an AniList ID */
export function isAnilistId(paramId: string): boolean {
  return paramId.startsWith("anilist-");
}

// ── Legacy "mal-" URL id support (metadata still 100% AniList) ──
//
// Before the Jikan/MAL removal, anime URL ids looked like
// "mal-21-one-piece". Old bookmarks / continue-watching entries still
// use that scheme. These helpers let the app DETECT such ids; the
// metadata itself is then resolved through AniList's idMal index
// (see getAnimeDetailsByMalId).

const LEGACY_MAL_URL_PREFIX = "mal";

/** Decode a legacy "mal-{id}-{slug}" URL id. Returns null otherwise. */
export function decodeLegacyMalUrlId(
  paramId: string,
): { id: number; type: MWMediaType } | null {
  const [prefix, idStr] = paramId.split("-", 2);
  if (prefix !== LEGACY_MAL_URL_PREFIX) return null;
  const id = parseInt(idStr, 10);
  if (Number.isNaN(id)) return null;
  return { id, type: MWMediaType.ANIME };
}

/** Check if a URL media ID uses the legacy "mal-" scheme */
export function isLegacyMalUrlId(paramId: string): boolean {
  return paramId.startsWith(`${LEGACY_MAL_URL_PREFIX}-`);
}

// ── Convert AniList media → MWMediaMeta ──

/**
 * Convert an AniList media entry into the player's MWMediaMeta shape.
 *
 * AniList exposes `episodes` (total episode count when known) but does
 * NOT expose per-episode metadata (titles/air dates) via the Media
 * query — those require a separate Episode-Page fetch. For the player
 * to show an episode picker (the "Episodes" button in the player
 * overlay), we synthesize a single synthetic "Season 1" with N
 * episode stubs where N = `media.episodes` (or `nextAiringEpisode.episode`
 * for airing anime, or a format-based default). Each stub has:
 *   id      → string of the episode number (1, 2, 3, ...)
 *   number  → episode number
 *   title   → "Episode N" (until a richer source is wired in)
 *   air_date → "2000-01-01" for aired episodes, the actual future date
 *              for the upcoming episode (when nextAiringEpisode is set)
 *   still_path / overview → empty
 *
 * This synthetic season flows through:
 *   anilistToMWMeta → DetailedMeta → usePlayerMeta.setPlayerMeta
 *     → PlayerMeta.type = "show", episodes = [...], season = {...}
 *     → Episodes button renders, user can pick episode N
 *     → setPlayerMeta builds scrapeMedia with episode.number = N
 *     → Miroru URL: /api/{anilistId}/{N}/sub?server={server}
 *
 * For anime movies / specials with episodes == null or 1, we still
 * synthesize a single-episode season so the type-system stays
 * consistent (ANIME always carries seasons + seasonData now).
 */
export function anilistToMWMeta(media: AniListMedia): MWMediaMeta {
  const title =
    media.title.english ??
    media.title.romaji ??
    media.title.native ??
    "Unknown";

  // Total episode count. AniList returns `episodes: null` for
  // currently-airing anime (where the final episode count is unknown)
  // AND for some long-running anime (e.g. One Piece). In those cases,
  // `nextAiringEpisode.episode` tells us the next-to-air episode
  // number, which we can use as a lower bound for the picker.
  //
  // Priority:
  //   1. media.episodes             (canonical count, set when anime has ended)
  //   2. nextAiringEpisode.episode  (current/upcoming episode for airing anime)
  //   3. defaultCount               (fallback: 12 for TV/ONA/OVA, 1 for movies)
  //
  // For One Piece this goes from showing 12 episodes → showing 1173.
  const format = media.format ?? "";
  const defaultCount = /^(TV|ONA|OVA)$/.test(format) ? 12 : 1;
  const nextEpNum = media.nextAiringEpisode?.episode ?? null;
  const episodeCount = Math.max(1, media.episodes ?? nextEpNum ?? defaultCount);

  // Air-date logic: every episode except the *upcoming* one is presumed
  // to have aired (AniList doesn't give us per-episode air dates via the
  // Media query). The "upcoming" episode (when nextAiringEpisode is set)
  // gets the actual airingAt date (in the future) so it correctly shows
  // as "Unreleased" — every other episode gets a past date so:
  //   - `episode.air_date ? ...` evaluates the aired branch (not "Unreleased")
  //   - `hasAired(air_date)` returns true (so the episode isn't greyed out)
  //
  // Date "2000-01-01" was chosen as a stable past sentinel — any past
  // date works.
  const airedSentinel = "2000-01-01";
  const upcomingAirDate =
    nextEpNum != null && media.nextAiringEpisode?.airingAt != null
      ? new Date(media.nextAiringEpisode.airingAt * 1000)
          .toISOString()
          .slice(0, 10)
      : null;

  // Build a synthetic Season 1 with N episode stubs.
  //
  // AniList doesn't expose per-episode still images via the Media
  // query, so every stub gets `still_path = null` by default — which
  // makes the episode picker show a generic FILM icon for every cell.
  // For anime, we fall back to the show's cover image so the picker
  // looks alive instead of a wall of icons. We store the full
  // cover URL directly in `still_path`; EpisodeItem detects a full
  // URL (starts with "http") and uses it as-is, otherwise it
  // prepends the TMDB image base.
  const seasonId = "1";
  const coverFallback = media.coverImage.large ?? null;
  const episodes = Array.from({ length: episodeCount }, (_, i) => {
    const n = i + 1;
    const isUpcoming = nextEpNum != null && n === nextEpNum;
    return {
      id: String(n),
      number: n,
      title: `Episode ${n}`,
      air_date: isUpcoming && upcomingAirDate ? upcomingAirDate : airedSentinel,
      still_path: coverFallback,
      overview: "",
    };
  });

  return {
    title,
    id: media.id.toString(),
    year: media.startDate.year?.toString(),
    poster: media.coverImage.large ?? undefined,
    overview: media.description ?? undefined,
    type: MWMediaType.ANIME,
    seasons: [{ id: seasonId, number: 1, title: "Season 1" }],
    seasonData: {
      id: seasonId,
      number: 1,
      title: "Season 1",
      episodes,
    },
  };
}

// ── Convert AniList search result → MediaItem ──

export interface AniListMediaItem {
  id: string;
  title: string;
  year: number;
  poster: string | undefined;
  type: "anime";
  anilistId: number;
  episodes: number | null;
  score: number | null;
  format: string | null;
}

export function anilistSearchToMediaItem(
  result: AniListSearchResult,
): AniListMediaItem {
  return {
    id: anilistIdToUrlId(result.id, result.title),
    title: result.title,
    year: result.year ?? 0,
    poster: result.poster,
    type: "anime",
    anilistId: result.id,
    episodes: result.episodes,
    score: result.score,
    format: result.format,
  };
}
