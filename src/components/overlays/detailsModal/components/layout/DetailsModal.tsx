import classNames from "classnames";
import { useCallback, useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";

import {
  anilistIdToUrlId,
  anilistToMWMeta,
  getAnimeDetails,
  getAnimeDetailsByMalId,
} from "@/backend/metadata/anilist";
import {
  getMediaBackdrop,
  getMediaDetails,
  getMediaLogo,
  getMediaPoster,
} from "@/backend/metadata/tmdb";
import { MWMediaType } from "@/backend/metadata/types/mw";
import {
  TMDBContentTypes,
  TMDBMovieData,
  TMDBShowData,
} from "@/backend/metadata/types/tmdb";
import { IconPatch } from "@/components/buttons/IconPatch";
import { Icons } from "@/components/Icon";
import { Flare } from "@/components/utils/Flare";
import { useOverlayStack } from "@/stores/interface/overlayStack";

import { DetailsContent } from "./DetailsContent";
import { DetailsSkeleton } from "./DetailsSkeleton";
import { OverlayPortal } from "../../../OverlayDisplay";
import { DetailsModalProps } from "../../types";

export function DetailsModal({
  id,
  data: _data,
  minimal: _minimal,
}: DetailsModalProps) {
  // Player details modal should always be minimal (hide episode carousel and movie watch button)
  const minimal = _minimal || id === "player-details";
  const { hideModal, isModalVisible, modalStack, getModalData } =
    useOverlayStack();
  const [detailsData, setDetailsData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  const modalIndex = modalStack.indexOf(id);
  const zIndex = modalIndex >= 0 ? 1000 + modalIndex : 999;

  const hide = useCallback(() => hideModal(id), [hideModal, id]);
  const isShown = isModalVisible(id);
  const modalData = getModalData(id);

  // Only show modal if there's data to display
  const shouldShow = Boolean(isShown && (modalData?.id || _data?.id));

  useEffect(() => {
    const fetchDetails = async () => {
      // Use data from overlayStack or fallback to props for backward compatibility
      const data = modalData || _data;
      if (!data?.id || !data?.type) return;

      setIsLoading(true);
      try {
        // ── AniList anime path (the only anime metadata source) ──
        if (data.type === "anime") {
          // Legacy "mal-" items are resolved through AniList's idMal
          // index — the MAL API is never called.
          const media = data.malUrlId
            ? await getAnimeDetailsByMalId(data.id)
            : await getAnimeDetails(data.id);
          if (media) {
            // Reuse the same synthesis logic the player uses so the
            // modal's episode picker matches what the player shows.
            // anilistToMWMeta always returns type=ANIME with a fully
            // populated seasonData (1 season + N episodes).
            const meta = anilistToMWMeta(media);
            // Type narrowing: TS doesn't infer that meta is the SERIES|ANIME
            // variant here just because we got it from anilistToMWMeta.
            // Use a typed const so we can access seasonData safely.
            const seasonMeta =
              meta.type === MWMediaType.ANIME ? meta : undefined;
            const episodes = seasonMeta?.seasonData.episodes ?? [];
            const title =
              media.title.english ??
              media.title.romaji ??
              media.title.native ??
              "Unknown";
            const posterUrl =
              media.coverImage.extraLarge ??
              media.coverImage.large ??
              media.coverImage.medium ??
              undefined;
            // AniList has a real banner image — fall back to the poster.
            const backdrop = media.bannerImage ?? posterUrl;
            const start = media.startDate;
            // AniList descriptions contain light HTML (<br>, <i>, ...) —
            // strip the tags and collapse whitespace for the modal.
            const cleanDescription = (media.description ?? "")
              .replace(/<br\s*\/?>/gi, "\n")
              .replace(/<[^>]+>/g, "")
              .replace(/\r\n/g, "\n")
              .trim();
            setDetailsData({
              title,
              overview: cleanDescription || undefined,
              backdrop,
              posterUrl,
              episodes: media.episodes ?? episodes.length,
              genres: (media.genres ?? []).map((g, i) => ({
                id: i,
                name: g,
              })),
              // AniList scores are 0–100 — normalize to the 0–10 scale
              // the modal's star rating expects.
              voteAverage:
                media.averageScore != null ? media.averageScore / 10 : 0,
              voteCount: media.popularity ?? media.favourites ?? 0,
              releaseDate: start?.year
                ? `${start.year}-${(start.month ?? 1).toString().padStart(2, "0")}-${(start.day ?? 1).toString().padStart(2, "0")}`
                : undefined,
              // Use "show" (not "movie") so the modal renders the
              // episode picker + uses the show-style play-button path.
              type: "show",
              id: media.id,
              // Canonical AniList URL id (e.g. "anilist-21-one-piece")
              // so DetailsContent.handlePlayClick can navigate to
              // /media/anilist-… instead of /media/tmdb-movie-…
              anilistUrlId: anilistIdToUrlId(media.id, title),
              // Pass through the synthesized seasonData so the modal's
              // episode carousel works without an extra fetch.
              seasonData: {
                seasons: meta.seasons ?? [],
                episodes: episodes.map((ep) => ({
                  id: ep.id,
                  name: ep.title,
                  episode_number: ep.number,
                  overview: ep.overview,
                  still_path: ep.still_path,
                  air_date: ep.air_date,
                  season_number: 1,
                })),
              },
            });
          }
        } else {
          // ── TMDB movie/series path ──
          const type =
            data.type === "movie"
              ? TMDBContentTypes.MOVIE
              : TMDBContentTypes.TV;
          const details = await getMediaDetails(
            data.id.toString(),
            type,
            false,
          );
          const backdropUrl = getMediaBackdrop(details.backdrop_path);
          const logoUrl = await getMediaLogo(data.id.toString(), type);
          if (type === TMDBContentTypes.MOVIE) {
            const movieDetails = details as TMDBMovieData;
            const posterUrl = getMediaPoster(movieDetails.poster_path);
            setDetailsData({
              title: movieDetails.title,
              overview: movieDetails.overview,
              backdrop: backdropUrl,
              posterUrl,
              runtime: movieDetails.runtime,
              genres: movieDetails.genres,
              language: movieDetails.original_language,
              voteAverage: movieDetails.vote_average,
              voteCount: movieDetails.vote_count,
              releaseDate: movieDetails.release_date,
              rating: movieDetails.release_dates?.results?.find(
                (r) => r.iso_3166_1 === "US",
              )?.release_dates?.[0]?.certification,
              type: "movie",
              id: movieDetails.id,
              imdbId: movieDetails.external_ids?.imdb_id,
              logoUrl,
              collection: movieDetails.belongs_to_collection,
            });
          } else {
            const showDetails = details as TMDBShowData & {
              episodes: Array<{
                id: number;
                name: string;
                episode_number: number;
                overview: string;
                still_path: string | null;
                air_date: string;
                season_number: number;
              }>;
            };
            const posterUrl = getMediaPoster(showDetails.poster_path);
            setDetailsData({
              title: showDetails.name,
              overview: showDetails.overview,
              backdrop: backdropUrl,
              posterUrl,
              episodes: showDetails.number_of_episodes,
              seasons: showDetails.number_of_seasons,
              genres: showDetails.genres,
              language: showDetails.original_language,
              voteAverage: showDetails.vote_average,
              voteCount: showDetails.vote_count,
              releaseDate: showDetails.first_air_date,
              rating: showDetails.content_ratings?.results?.find(
                (r) => r.iso_3166_1 === "US",
              )?.rating,
              type: "show",
              id: showDetails.id,
              imdbId: showDetails.external_ids?.imdb_id,
              seasonData: {
                seasons: showDetails.seasons,
                episodes: showDetails.episodes,
              },
              logoUrl,
            });
          }
        } // end of TMDB movie/series path
      } catch (err) {
        console.error("Failed to fetch media details:", err);
      } finally {
        setIsLoading(false);
      }
    };

    if (shouldShow) {
      fetchDetails();
    }
  }, [shouldShow, modalData, _data]);

  useEffect(() => {
    if (isShown && !modalData?.id && !_data?.id && !isLoading) {
      hide();
    }
  }, [isShown, modalData, _data, isLoading, hide]);

  return (
    <OverlayPortal
      darken
      close={hide}
      show={shouldShow}
      durationClass="duration-500"
      zIndex={zIndex}
    >
      <Helmet>
        <html data-no-scroll />
      </Helmet>
      <div className="flex absolute inset-0 items-center justify-center pt-safe">
        <Flare.Base
          className={classNames(
            "group -m-[0.705em] rounded-3xl bg-background-main",
            "max-h-[900px] max-w-[1200px]",
            "bg-mediaCard-hoverBackground/60 backdrop-filter backdrop-blur-lg shadow-lg overflow-hidden",
            "h-[97%] w-[95%]",
            "relative",
          )}
        >
          <div className="transition-transform duration-300 h-full relative">
            <Flare.Light
              flareSize={300}
              cssColorVar="--colors-mediaCard-hoverAccent"
              backgroundClass="bg-modal-background duration-100"
              className="rounded-3xl bg-background-main group-hover:opacity-100 transition-opacity duration-300"
            />
            <div className="absolute right-4 top-4 z-50 pointer-events-auto">
              <button
                type="button"
                className="text-s font-semibold text-type-secondary hover:text-white transition-transform hover:scale-95 select-none"
                onClick={hide}
              >
                <IconPatch icon={Icons.X} />
              </button>
            </div>
            <Flare.Child className="pointer-events-auto relative h-full overflow-y-auto scrollbar-none select-text">
              <div className="select-text">
                {isLoading || !detailsData ? (
                  <DetailsSkeleton />
                ) : (
                  <DetailsContent data={detailsData} minimal={minimal} />
                )}
              </div>
            </Flare.Child>
          </div>
        </Flare.Base>
      </div>
    </OverlayPortal>
  );
}
