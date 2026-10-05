import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  AniListSearchResult,
  getAiringAnime,
  getAllTimePopularAnime,
  getPopularAnime,
  getTopRatedAnime,
  getTrendingAnime,
  getUpcomingAnime,
  anilistIdToUrlId,
} from "@/backend/metadata/anilist";
import { Icon, Icons } from "@/components/Icon";
import { MediaCard } from "@/components/media/MediaCard";
import { Flare } from "@/components/utils/Flare";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MediaItem } from "@/utils/mediaTypes";

import { CarouselNavButtons } from "./CarouselNavButtons";

// ── Anime carousel types ──

export type AnimeContentType =
  | "trending"
  | "popular"
  | "airing"
  | "upcoming"
  | "topRated"
  | "allTimePopular";

interface AnimeMediaCarouselProps {
  contentType: AnimeContentType;
  carouselRefs: React.MutableRefObject<{
    [key: string]: HTMLDivElement | null;
  }>;
  onShowDetails?: (media: MediaItem) => void;
  priority?: boolean;
}

// ── Fetch function map ──

const ANIME_FETCHERS: Record<
  AnimeContentType,
  (page: number, perPage: number) => Promise<AniListSearchResult[]>
> = {
  trending: getTrendingAnime,
  popular: getPopularAnime,
  airing: getAiringAnime,
  upcoming: getUpcomingAnime,
  topRated: getTopRatedAnime,
  allTimePopular: getAllTimePopularAnime,
};

// ── Convert AniList result → MediaItem for MediaCard ──

function anilistToMediaItem(result: AniListSearchResult): MediaItem {
  return {
    id: anilistIdToUrlId(result.id, result.title),
    title: result.title,
    year: result.year,
    poster: result.poster,
    type: "show", // Anime episodes treated like show for MediaCard
  };
}

// ── Skeleton card ──

function AnimeSkeletonCard() {
  return (
    <div className="relative mt-4 group cursor-default user-select-none rounded-xl p-2 bg-transparent transition-colors duration-300 w-[10rem] md:w-[11.5rem] h-auto">
      <MediaCard
        media={{
          id: `skeleton-${Math.random().toString(36).substring(2)}`,
          title: "",
          poster: "",
          type: "show",
        }}
        forceSkeleton
      />
    </div>
  );
}

// ── Main component ──

export function AnimeMediaCarousel({
  contentType,
  carouselRefs,
  onShowDetails,
  priority = false,
}: AnimeMediaCarouselProps) {
  const { t } = useTranslation();
  const { isMobile } = useIsMobile();
  const browser = !!(window as any).chrome;

  const [media, setMedia] = useState<AniListSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Section title
  const sectionTitle = t(`discover.carousel.title.anime.${contentType}`);

  // Fetch anime data
  const fetchAnime = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const fetcher = ANIME_FETCHERS[contentType];
      if (!fetcher) {
        throw new Error(`Unknown anime content type: ${contentType}`);
      }
      const results = await fetcher(1, 25); // 25 cards per carousel
      setMedia(results);
    } catch (err) {
      console.error(`Error fetching anime (${contentType}):`, err);
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [contentType]);

  useEffect(() => {
    fetchAnime();
  }, [fetchAnime]);

  // ⚠️ All hooks MUST be declared before any early return, otherwise React
  // throws error #300 ("Rendered fewer hooks than expected"). The previous
  // implementation placed `useRef` and `useCallback` AFTER the early return
  // below, which crashed the carousel whenever an anime fetch errored out
  // or returned an empty list.
  const isScrollingRef = useRef(false);
  const handleWheel = React.useCallback(
    (e: React.WheelEvent) => {
      if (isScrollingRef.current) return;
      isScrollingRef.current = true;

      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.stopPropagation();
        e.preventDefault();
      }

      if (browser) {
        setTimeout(() => {
          isScrollingRef.current = false;
        }, 345);
      } else {
        isScrollingRef.current = false;
      }
    },
    [browser],
  );

  // Hide if error or no content after loading
  if (!isLoading && (error || media.length === 0)) {
    return null;
  }

  const categorySlug = `anime-${contentType}`;

  return (
    <div>
      <div className="flex items-center justify-between ml-2 md:ml-8 mt-2">
        <div className="flex flex-col pl-2 lg:pl-[68px]">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl cursor-default font-bold text-white md:text-2xl pl-0 text-balance">
              {sectionTitle}
            </h2>
          </div>
        </div>
      </div>
      <div className="relative overflow-hidden carousel-container md:pb-4">
        <div
          id={`carousel-${categorySlug}`}
          className="grid grid-flow-col auto-cols-max gap-4 pt-0 overflow-x-scroll scrollbar-none rounded-xl overflow-y-hidden md:pl-8 md:pr-8"
          ref={(el) => {
            carouselRefs.current[categorySlug] = el;
          }}
          onWheel={handleWheel}
        >
          <div className="lg:w-12" />

          {media.length > 0
            ? media.map((item) => (
                <div
                  onContextMenu={(e: React.MouseEvent<HTMLDivElement>) =>
                    e.preventDefault()
                  }
                  key={`anime-${item.id}`}
                  className="relative mt-4 group cursor-pointer user-select-none rounded-xl p-2 bg-transparent transition-colors duration-300 w-[10rem] md:w-[11.5rem] h-auto"
                >
                  <MediaCard
                    linkable
                    media={anilistToMediaItem(item)}
                    onShowDetails={onShowDetails}
                  />
                </div>
              ))
            : Array(10)
                .fill(null)
                .map((_, index) => (
                  <AnimeSkeletonCard
                    // Array index is acceptable here: the array is a fixed
                    // length-10 placeholder that never reorders.
                    // eslint-disable-next-line react/no-array-index-key
                    key={`skeleton-${categorySlug}-${index}`}
                  />
                ))}

          <div className="lg:w-12" />
        </div>

        {!isMobile && (
          <CarouselNavButtons
            categorySlug={categorySlug}
            carouselRefs={carouselRefs}
          />
        )}
      </div>
    </div>
  );
}
