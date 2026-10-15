import { useMemo } from "react";

import { getProgressPercentage, useProgressStore } from "@/stores/progress";
import {
  ShowProgressResult,
  shouldShowProgress,
} from "@/stores/progress/utils";
import { MediaItem } from "@/utils/mediaTypes";

import { MediaCard } from "./MediaCard";

function formatSeries(series?: ShowProgressResult | null) {
  if (!series || !series.episode || !series.season) return undefined;
  return {
    episode: series.episode?.number,
    season: series.season?.number,
    episodeId: series.episode?.id,
    seasonId: series.season?.id,
  };
}

export interface WatchedMediaCardProps {
  media: MediaItem;
  closable?: boolean;
  onClose?: () => void;
  onShowDetails?: (media: MediaItem) => void;
  editable?: boolean;
  onEdit?: () => void;
}

export function WatchedMediaCard(props: WatchedMediaCardProps) {
  const progressItems = useProgressStore((s) => s.items);
  const item = useMemo(() => {
    return progressItems[props.media.id];
  }, [progressItems, props.media]);
  const itemToDisplay = useMemo(
    () => (item ? shouldShowProgress(item) : null),
    [item],
  );
  const percentage = itemToDisplay?.show
    ? getProgressPercentage(
        itemToDisplay.progress.watched,
        itemToDisplay.progress.duration,
      )
    : undefined;

  // NOTE: Anime progress entries are keyed by their AniList URL id
  // ("anilist-{id}-{slug}" — legacy entries by "mal-{id}-{slug}") and
  // the card links STRAIGHT to /media/anilist-… — the old
  // "resolve a TMDB show by title" redirect was removed because anime
  // is now served exclusively by AniList and never by TMDB.

  return (
    <MediaCard
      media={props.media}
      series={formatSeries(itemToDisplay)}
      linkable
      percentage={percentage}
      onClose={props.onClose}
      closable={props.closable}
      onShowDetails={props.onShowDetails}
      editable={props.editable}
      onEdit={props.onEdit}
    />
  );
}
