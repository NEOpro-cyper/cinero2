import {
  decodeAnilistId,
  decodeLegacyMalUrlId,
} from "@/backend/metadata/anilist";

/**
 * Build the `showModal("details", …)` payload from a MediaItem-shaped object.
 *
 * Movie/TV items pass through unchanged. Anime items (whose `id` is an
 * AniList URL id like "anilist-21-one-piece") are detected via the
 * "anilist-" prefix and converted to:
 *   { id: <numeric AniList id>, type: "anime", anilistUrlId: <full URL id> }
 *
 * Legacy anime ids using the old MAL scheme ("mal-21-one-piece" — from
 * bookmarks/progress saved before the Jikan/MAL removal) are also
 * detected and forwarded with `malUrlId`; the details modal then
 * resolves them through AniList's idMal index (NOT the MAL API).
 *
 * Without this helper, callers used `Number(media.id)` which returns NaN
 * for "anilist-21-one-piece", and `media.type === "movie" ? "movie" : "show"`
 * which collapsed anime → "show" — so the modal's anime branch
 * (`if (data.type === "anime")`) was never taken and the TMDB branch
 * 404'd with id=NaN.
 *
 * The returned `anilistUrlId` is forwarded to the modal so the play
 * button can build the correct `/media/anilist-…` URL (instead of
 * treating the numeric AniList id as a TMDB id).
 */
export function buildDetailsModalData<
  T extends { id: string | number; type: "movie" | "show" | "anime" },
>(
  media: T,
): {
  id: number;
  type: "movie" | "show" | "anime";
  anilistUrlId?: string;
  malUrlId?: string;
} {
  // FeaturedMedia (from the homepage hero carousel) has id: number and
  // is always TMDB-based, so it skips the anime detection. MediaItem
  // has id: string — for anime it's the URL-encoded "anilist-<id>-<slug>"
  // (or the legacy "mal-<id>-<slug>").
  if (typeof media.id === "string") {
    const anilist = decodeAnilistId(media.id);
    if (anilist) {
      return {
        id: anilist.id,
        type: "anime",
        anilistUrlId: media.id,
      };
    }
    const legacyMal = decodeLegacyMalUrlId(media.id);
    if (legacyMal) {
      return {
        id: legacyMal.id,
        type: "anime",
        malUrlId: media.id,
      };
    }
  }
  return {
    id: Number(media.id),
    type: media.type === "movie" ? "movie" : "show",
  };
}
