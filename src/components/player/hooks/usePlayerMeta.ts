import { useCallback, useMemo } from "react";

import { anilistIdToUrlId } from "@/backend/metadata/anilist";
import { DetailedMeta } from "@/backend/metadata/getmeta";
import { MWMediaType } from "@/backend/metadata/types/mw";
import { usePlayer } from "@/components/player/hooks/usePlayer";
import {
  PlayerMeta,
  metaToScrapeMedia,
  playerStatus,
} from "@/stores/player/slices/source";
import { usePreferencesStore } from "@/stores/preferences";

export function usePlayerMeta() {
  const { meta, setMeta } = usePlayer();
  const scrapeMedia = useMemo(
    () => (meta ? metaToScrapeMedia(meta) : null),
    [meta],
  );

  // Read the anime Sub/Dub preference so it can be attached to the
  // PlayerMeta. This way both the auto-scrape path (useProviderScrape)
  // and the manual-pick path (useSourceSelection) have access to the
  // user's chosen audio category.
  //
  // NOTE: The category ("sub" | "dub") is used by the Zoko anime
  // server URL builder (/{category}/{malId}/{episode}). The MAL id
  // itself comes from AniList's cross-linked idMal field.
  const miroruCategory = usePreferencesStore((s) => s.miroruCategory);

  const setDirectMeta = useCallback(
    (m: PlayerMeta) => {
      setMeta(m, playerStatus.SCRAPING);
    },
    [setMeta],
  );

  const setPlayerMeta = useCallback(
    (m: DetailedMeta, episodeId?: string) => {
      let playerMeta: PlayerMeta;
      // Anime goes through the SHOW branch — anilistToMWMeta synthesizes
      // a single "Season 1" with N episodes, so the episode picker,
      // next-episode button, and per-episode progress all work. The
      // MAL id (cross-linked on AniList via idMal and forwarded through
      // DetailedMeta.malId) is preserved as `malId` on the PlayerMeta so
      // the Zoko anime custom server can build its URL
      // (/api/mal/{category}/{malId}/{episode}?worker=1).
      if (
        m.meta.type === MWMediaType.SERIES ||
        m.meta.type === MWMediaType.ANIME
      ) {
        const ep = m.meta.seasonData.episodes.find((v) => v.id === episodeId);
        // For anime, default to episode 1 if no episodeId was passed
        // (e.g. on initial page load).
        const fallbackEp =
          m.meta.type === MWMediaType.ANIME
            ? m.meta.seasonData.episodes[0]
            : undefined;
        const chosenEp = ep ?? fallbackEp;
        if (!chosenEp) return null;
        const isAnime = m.meta.type === MWMediaType.ANIME;
        // For anime, the canonical identifier is the AniList URL id
        // (e.g. "anilist-21-one-piece"). We store it as `tmdbId` so:
        //   1. The progress store keys entries by "anilist-21-one-piece"
        //      (no collision with TMDB id 21).
        //   2. mediaItemToId() sees the "anilist-" prefix and returns it
        //      as-is → Continue Watching card links to
        //      /media/anilist-21-one-piece/1/1 (correct anime player URL)
        //      instead of /media/tmdb-tv-21-one-piece/1/1 (broken).
        // The MAL id cross-linked on AniList (m.malId from
        // DetailedMeta.malId) is preserved separately as `malId`
        // for the Zoko anime server URL builder.
        const animeUrlId = isAnime
          ? anilistIdToUrlId(parseInt(m.meta.id, 10), m.meta.title)
          : "";
        playerMeta = {
          type: "show",
          releaseYear: +(m.meta.year ?? 0),
          title: m.meta.title,
          poster: m.meta.poster,
          tmdbId: m.tmdbId ?? (isAnime ? animeUrlId : "") ?? "",
          imdbId: m.imdbId,
          overview: m.meta.overview,
          episodes: m.meta.seasonData.episodes.map((v) => ({
            number: v.number,
            title: v.title,
            tmdbId: v.id,
            air_date: v.air_date,
            overview: v.overview,
          })),
          episode: {
            number: chosenEp.number,
            title: chosenEp.title,
            tmdbId: chosenEp.id,
            air_date: chosenEp.air_date,
            overview: chosenEp.overview,
          },
          season: {
            number: m.meta.seasonData.number,
            title: m.meta.seasonData.title,
            tmdbId: m.meta.seasonData.id,
          },
          malId: isAnime && m.malId ? parseInt(m.malId, 10) : undefined,
          // Attach Sub/Dub preference so the manual source-picker path
          // (scrapeCustomServerByMeta → playerMetaToCustomScrapeMedia)
          // can read it. The auto-scrape path (useProviderScrape)
          // reads it from the preferences store directly, but having
          // it on the meta too keeps the two paths consistent.
          miroruCategory: isAnime ? miroruCategory : undefined,
        };
      } else {
        // Regular movies (TMDB-based).
        playerMeta = {
          type: "movie",
          releaseYear: +(m.meta.year ?? 0),
          title: m.meta.title,
          poster: m.meta.poster,
          tmdbId: m.tmdbId ?? "",
          imdbId: m.imdbId,
          overview: m.meta.overview,
        };
      }
      setDirectMeta(playerMeta);
      return playerMeta;
    },
    [setDirectMeta, miroruCategory],
  );

  return {
    playerMeta: meta,
    setPlayerMeta,
    setDirectMeta,
    scrapeMedia,
  };
}
