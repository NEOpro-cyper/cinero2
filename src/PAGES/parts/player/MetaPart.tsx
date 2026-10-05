import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { useAsync } from "react-use";
import type { AsyncReturnType } from "type-fest";

import { isAllowedExtensionVersion } from "@/backend/extension/compatibility";
import { extensionInfo, sendPage } from "@/backend/extension/messaging";
import { setCachedMetadata } from "@/backend/helpers/providerApi";
import {
  anilistIdToUrlId,
  decodeAnilistId,
  decodeLegacyMalUrlId,
} from "@/backend/metadata/anilist";
import { DetailedMeta, getMetaFromId } from "@/backend/metadata/getmeta";
import { decodeTMDBId } from "@/backend/metadata/tmdb";
import { MWMediaType } from "@/backend/metadata/types/mw";
import { getProviders } from "@/backend/providers/providers";
import { Button } from "@/components/buttons/Button";
import { Icons } from "@/components/Icon";
import { IconPill } from "@/components/layout/IconPill";
import { Loading } from "@/components/layout/Loading";
import { Paragraph } from "@/components/text/Paragraph";
import { Title } from "@/components/text/Title";
import { ErrorContainer, ErrorLayout } from "@/pages/layouts/ErrorLayout";
import { conf } from "@/setup/config";

export interface MetaPartProps {
  onGetMeta?: (meta: DetailedMeta, episodeId?: string) => void;
}

function isDisallowedMedia(id: string, type: MWMediaType): boolean {
  const disallowedEntries = conf().DISALLOWED_IDS.map((v) => v.split("-"));
  if (disallowedEntries.find((entry) => id === entry[1] && type === entry[0]))
    return true;
  return false;
}

export function MetaPart(props: MetaPartProps) {
  const { t } = useTranslation();
  const params = useParams<{
    media: string;
    episode?: string;
    season?: string;
  }>();
  const navigate = useNavigate();

  const { error, value, loading } = useAsync(async () => {
    const info = await extensionInfo();
    const isValidExtension =
      info?.success && isAllowedExtensionVersion(info.version) && info.allowed;

    if (isValidExtension) {
      if (!info.hasPermission) throw new Error("extension-no-permission");
    }

    // use providers metadata
    setCachedMetadata([
      ...getProviders().listSources(),
      ...getProviders().listEmbeds(),
    ]);

    // get media meta data
    // Anime URL ids ("anilist-…" or legacy "mal-…") are detected first
    // and resolved through AniList inside getMetaFromId — TMDB is never
    // consulted for anime.
    let data: ReturnType<typeof decodeTMDBId> = null;
    let isAnimeUrl = false;
    try {
      if (!params.media) throw new Error("no media params");
      const animeData = decodeAnilistId(params.media);
      const legacyMalData = animeData
        ? null
        : decodeLegacyMalUrlId(params.media);
      if (animeData || legacyMalData) {
        const decoded = animeData ?? legacyMalData!;
        data = { id: decoded.id.toString(), type: decoded.type };
        isAnimeUrl = true;
      } else {
        data = decodeTMDBId(params.media);
      }
    } catch {
      // error dont matter, itll just be a 404
    }
    if (!data) return null;

    if (isDisallowedMedia(data.id, data.type)) throw new Error("legal");

    let meta: AsyncReturnType<typeof getMetaFromId> = null;
    try {
      // For anime we pass the FULL URL id ("anilist-…" / legacy "mal-…")
      // so getMetaFromId can pick the right AniList lookup (Media(id:)
      // vs Media(idMal:)).
      meta = await getMetaFromId(
        data.type,
        isAnimeUrl && params.media ? params.media : data.id,
        params.season,
      );
    } catch (err) {
      if ((err as any).status === 404) {
        return null;
      }
      throw err;
    }
    if (!meta) return null;

    // Legacy "mal-…" URLs are canonicalized to the new "anilist-…"
    // scheme (the resolved AniList id comes back in meta.meta.id) so
    // progress/bookmarks keep a single consistent key namespace.
    const canonicalMediaId =
      isAnimeUrl && params.media && params.media.startsWith("mal-")
        ? anilistIdToUrlId(parseInt(meta.meta.id, 10), meta.meta.title)
        : params.media ?? data.id;

    // replace link with new link if youre not already on the right link
    let epId = params.episode;
    // Anime now carries synthesized seasons + seasonData (same shape as
    // SERIES), so treat it the same way: default to episode 1 and
    // navigate to /media/{id}/{seasonId}/{episodeId} so the URL
    // reflects the current episode.
    if (
      meta.meta.type === MWMediaType.SERIES ||
      meta.meta.type === MWMediaType.ANIME
    ) {
      let ep = meta.meta.seasonData.episodes.find(
        (v) => v.id === params.episode,
      );
      // Cross-source resume fallback: when a Continue Watching card
      // for an anime is redirected to a TMDB show URL, the
      // episode id in the URL is the MAL episode NUMBER (a small
      // integer like "5"), not a TMDB episode id (a big integer).
      // Match by number so the user lands on the episode they were
      // watching instead of being bounced back to episode 1.
      if (!ep && params.episode) {
        const epNum = parseInt(params.episode, 10);
        if (!Number.isNaN(epNum)) {
          ep = meta.meta.seasonData.episodes.find((v) => v.number === epNum);
        }
      }
      if (!ep) ep = meta.meta.seasonData.episodes[0];
      epId = ep.id;
      if (
        canonicalMediaId !== params.media ||
        params.season !== meta.meta.seasonData.id ||
        params.episode !== ep.id
      ) {
        navigate(
          `/media/${canonicalMediaId}/${meta.meta.seasonData.id}/${ep.id}`,
          {
            replace: true,
          },
        );
      }
    }

    props.onGetMeta?.(meta, epId);
  }, []);

  if (error && error.message === "extension-no-permission") {
    return (
      <ErrorLayout>
        <ErrorContainer>
          <IconPill icon={Icons.WAND}>
            {t("player.metadata.extensionPermission.badge")}
          </IconPill>
          <Title>{t("player.metadata.extensionPermission.title")}</Title>
          <Paragraph>{t("player.metadata.extensionPermission.text")}</Paragraph>
          <Button
            onClick={() => {
              sendPage({
                page: "PermissionGrant",
                redirectUrl: window.location.href,
              });
            }}
            theme="purple"
            padding="md:px-12 p-2.5"
            className="mt-6"
          >
            {t("player.metadata.extensionPermission.button")}
          </Button>
        </ErrorContainer>
      </ErrorLayout>
    );
  }

  if (error && error.message === "legal") {
    return (
      <ErrorLayout>
        <ErrorContainer>
          <IconPill icon={Icons.DRAGON}>
            {t("player.metadata.legal.badge")}
          </IconPill>
          <Title>{t("player.metadata.legal.title")}</Title>
          <Paragraph>{t("player.metadata.legal.text")}</Paragraph>
          <Button
            href="/"
            theme="purple"
            padding="md:px-12 p-2.5"
            className="mt-6"
          >
            {t("player.metadata.failed.homeButton")}
          </Button>
        </ErrorContainer>
      </ErrorLayout>
    );
  }

  if (error) {
    return (
      <ErrorLayout>
        <ErrorContainer>
          <IconPill icon={Icons.WAND}>
            {t("player.metadata.failed.badge")}
          </IconPill>
          <Title>{t("player.metadata.failed.title")}</Title>
          <Paragraph>{t("player.metadata.failed.text")}</Paragraph>
          <Button
            href="/"
            theme="purple"
            padding="md:px-12 p-2.5"
            className="mt-6"
          >
            {t("player.metadata.failed.homeButton")}
          </Button>
        </ErrorContainer>
      </ErrorLayout>
    );
  }

  if (!value && !loading) {
    return (
      <ErrorLayout>
        <ErrorContainer>
          <IconPill icon={Icons.WAND}>
            {t("player.metadata.notFound.badge")}
          </IconPill>
          <Title>{t("player.metadata.notFound.title")}</Title>
          <Paragraph>{t("player.metadata.notFound.text")}</Paragraph>
          <Button
            href="/"
            theme="purple"
            padding="md:px-12 p-2.5"
            className="mt-6"
          >
            {t("player.metadata.notFound.homeButton")}
          </Button>
        </ErrorContainer>
      </ErrorLayout>
    );
  }

  return (
    <ErrorLayout>
      <div className="flex items-center justify-center">
        <Loading />
      </div>
    </ErrorLayout>
  );
}
