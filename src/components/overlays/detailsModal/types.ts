import { ShowProgressResult } from "@/stores/progress/utils";

export interface DetailsContent {
  title: string;
  overview?: string;
  backdrop?: string;
  posterUrl?: string;
  runtime?: number | null;
  genres?: Array<{ id: number; name: string }>;
  language?: string;
  voteAverage?: number;
  voteCount?: number;
  releaseDate?: string;
  rating?: string;
  director?: string;
  actors?: string[];
  type?: "movie" | "show";
  id?: number;
  episodes?: number;
  seasons?: number;
  imdbId?: string;
  // Anime: the AniList URL id (e.g. "anilist-21-one-piece") so the play
  // button can navigate to /media/anilist-… instead of /media/tmdb-movie-…
  anilistUrlId?: string;
  episode?: {
    id: number;
    number: number;
  };
  seasonData?: {
    seasons: Array<{
      id: number;
      season_number: number;
      name: string;
      episode_count: number;
      overview: string;
      air_date: string;
      poster_path: string | null;
    }>;
    episodes: Array<{
      id: number;
      name: string;
      overview: string;
      episode_number: number;
      season_number: number;
      still_path: string | null;
      air_date: string;
      vote_average: number;
      vote_count: number;
    }>;
  };
  logoUrl?: string;
  collection?: {
    id: number;
    name: string;
    poster_path: string | null;
    backdrop_path: string | null;
  } | null;
}

export interface DetailsModalProps {
  id: string;
  data?: {
    id: number;
    type: "movie" | "show" | "anime";
    // Anime: AniList URL id for new-style items; legacy mal- URL id is
    // forwarded as-is so the modal can resolve it via AniList's idMal.
    anilistUrlId?: string;
    malUrlId?: string;
  };
  minimal?: boolean;
}

export interface DetailsContentProps {
  data: DetailsContent;
  minimal?: boolean;
}

export interface TrailerOverlayProps {
  trailerUrl: string;
  onClose: () => void;
}

export interface EpisodeCarouselProps {
  episodes: Array<{
    id: number;
    name: string;
    overview: string;
    episode_number: number;
    season_number: number;
    still_path: string | null;
    air_date: string;
    vote_average: number;
    vote_count: number;
  }>;
  showProgress?: {
    episode?: {
      id: string;
    };
  } | null;
  progress: Record<string, any>;
  selectedSeason: number;
  onSeasonChange: (season: number) => void;
  seasons: Array<{
    id: number;
    season_number: number;
    name: string;
    episode_count: number;
    overview: string;
    air_date: string;
    poster_path: string | null;
  }>;
  mediaId?: number;
  mediaTitle?: string;
  mediaPosterUrl?: string;
  totalEpisodes?: number;
}

export interface DetailsBodyProps {
  data: DetailsContent;
  onPlayClick: () => void;
  onShareClick: () => void;
  showProgress: ShowProgressResult | null;
  voteAverage?: number;
  voteCount?: number;
  releaseDate?: string;
  seasons?: number;
  imdbData?: {
    rating: number;
    votes: number;
    trailer_url?: string;
  };
}

export interface DetailsInfoProps {
  data: DetailsContent;
  imdbData?: any;
  rtData?: any;
  provider?: string;
  onCollectionClick?: () => void;
}

export interface DetailsRatingsProps {
  voteAverage?: number;
  voteCount?: number;
  imdbData?: any;
  rtData?: any;
  mediaId?: number;
  mediaType?: "movie" | "show";
  imdbId?: string;
  provider?: string;
}
