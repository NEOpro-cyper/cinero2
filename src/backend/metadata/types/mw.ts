export enum MWMediaType {
  MOVIE = "movie",
  SERIES = "series",
  ANIME = "anime",
}

export type MWSeasonMeta = {
  id: string;
  number: number;
  title: string;
};

export type MWSeasonWithEpisodeMeta = {
  id: string;
  number: number;
  title: string;
  episodes: {
    id: string;
    number: number;
    title: string;
    air_date: string;
    still_path: string | null;
    overview: string;
  }[];
};

type MWMediaMetaBase = {
  title: string;
  id: string;
  year?: string;
  poster?: string;
  overview?: string;
};

type MWMediaMetaSpecific =
  | {
      type: MWMediaType.MOVIE;
      seasons: undefined;
    }
  | {
      // ANIME behaves like SERIES when it has multiple episodes
      // (synthetic season is built by anilistToMWMeta). When the
      // anime is a single-episode movie/special, it falls into the
      // MOVIE branch instead.
      type: MWMediaType.SERIES | MWMediaType.ANIME;
      seasons: MWSeasonMeta[];
      seasonData: MWSeasonWithEpisodeMeta;
    };

export type MWMediaMeta = MWMediaMetaBase & MWMediaMetaSpecific;

export interface MWQuery {
  searchQuery: string;
}

export interface DetailedMeta {
  meta: MWMediaMeta;
  imdbId?: string;
  tmdbId?: string;
}
