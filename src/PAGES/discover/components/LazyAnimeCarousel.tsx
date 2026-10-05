import React from "react";

import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";
import { MediaItem } from "@/utils/mediaTypes";

import { AnimeContentType, AnimeMediaCarousel } from "./AnimeMediaCarousel";

interface LazyAnimeCarouselProps {
  contentType: AnimeContentType;
  carouselRefs: React.MutableRefObject<{
    [key: string]: HTMLDivElement | null;
  }>;
  onShowDetails?: (media: MediaItem) => void;
  priority?: boolean;
}

export function LazyAnimeCarousel({
  contentType,
  carouselRefs,
  onShowDetails,
  priority = false,
}: LazyAnimeCarouselProps) {
  const { ref, hasIntersected } = useIntersectionObserver<HTMLDivElement>({
    threshold: 0.1,
    rootMargin: "50px",
  });

  const shouldRender = priority || hasIntersected;

  return (
    <div ref={ref}>
      {shouldRender ? (
        <AnimeMediaCarousel
          contentType={contentType}
          carouselRefs={carouselRefs}
          onShowDetails={onShowDetails}
          priority={priority}
        />
      ) : (
        <div className="h-[20rem]" />
      )}
    </div>
  );
}
