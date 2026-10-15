import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { getCachedMetadata } from "@/backend/helpers/providerApi";
import { Toggle } from "@/components/buttons/Toggle";
import { Icon, Icons } from "@/components/Icon";
import { useCaptions } from "@/components/player/hooks/useCaptions";
import { Menu } from "@/components/player/internals/ContextMenu";
import { useOverlayRouter } from "@/hooks/useOverlayRouter";
import { usePlayerStore } from "@/stores/player/store";
import { qualityToString } from "@/stores/player/utils/qualities";
import { usePreferencesStore } from "@/stores/preferences";
import { useSubtitleStore } from "@/stores/subtitles";
import { getPrettyLanguageNameFromLocale } from "@/utils/language";
import { buildOpenInNewTabUrl } from "./Downloads";

export function SettingsMenu({ id }: { id: string }) {
  const { t } = useTranslation();
  const router = useOverlayRouter(id);
  const currentQuality = usePlayerStore((s) => s.currentQuality);
  const currentAudioTrack = usePlayerStore((s) => s.currentAudioTrack);
  const selectedCaptionLanguage = usePlayerStore(
    (s) => s.caption.selected?.language,
  );
  const subtitlesEnabled = useSubtitleStore((s) => s.enabled);
  const currentSourceId = usePlayerStore((s) => s.sourceId);
  const currentEmbedId = usePlayerStore(
    (s) => (s as any).embedId as string | null,
  );
  // Anime detection — used to gate the Sub/Dub picker.
  // Only anime media (mal-* URLs) uses the anime stream category, so the
  // menu item is hidden for movies/shows.
  const isAnime = usePlayerStore((s) => !!s.meta?.malId);
  // Show the current Sub/Dub category as the link's right-text.
  const miroruCategory = usePreferencesStore((s) => s.miroruCategory);
  const sourceName = useMemo(() => {
    if (!currentSourceId) return "...";
    const source = getCachedMetadata().find(
      (src) => src.id === currentSourceId,
    );
    if (!source) return "...";
    // For Miroru sources (any custom-miroru-* id), append the sub/dub
    // category so the user can see WHICH audio track is active without
    // opening the Miroru settings page. The backend name is already
    // part of the source's display name (e.g. "Miroru · Kiwi").
    if (currentSourceId.startsWith("custom-miroru")) {
      return `${source.name} · ${miroruCategory}`;
    }
    return source.name;
  }, [currentSourceId, miroruCategory]);
  const embedName = useMemo(() => {
    if (!currentEmbedId) return undefined;
    const meta = getCachedMetadata().find((s) => s.id === currentEmbedId);
    return meta?.name;
  }, [currentEmbedId]);
  const { toggleLastUsed } = useCaptions();

  const selectedLanguagePretty = selectedCaptionLanguage
    ? (getPrettyLanguageNameFromLocale(selectedCaptionLanguage) ??
      t("player.menus.subtitles.unknownLanguage"))
    : undefined;

  const selectedAudioLanguagePretty = currentAudioTrack
    ? (getPrettyLanguageNameFromLocale(currentAudioTrack.language) ??
      currentAudioTrack.label ??
      t("player.menus.subtitles.unknownLanguage"))
    : undefined;

  const source = usePlayerStore((s) => s.source);

  const downloadable = source?.type === "file" || source?.type === "hls";

  // Deep-link: show -> <base>/tv/<tmdbId>/<season>/<episode>, movie -> <base>/movie/<tmdbId>
  const meta = usePlayerStore((s) => s.meta);
  const openInNewTabUrl = useMemo(() => buildOpenInNewTabUrl(meta), [meta]);

  return (
    <Menu.Card>
      <Menu.Section grid>
        <Menu.ChevronLink
          box
          onClick={() => router.navigate("/quality")}
          rightText={currentQuality ? qualityToString(currentQuality) : ""}
        >
          {t("player.menus.settings.qualityItem")}
          <span className="text-type-secondary text-sm">
            {currentQuality
              ? qualityToString(currentQuality)
              : t("player.menus.quality.auto")}
          </span>
        </Menu.ChevronLink>
        <Menu.ChevronLink
          box
          onClick={() => router.navigate("/source")}
          rightText={sourceName}
        >
          {t("player.menus.settings.sourceItem")}
          <span className="text-type-secondary text-sm">{sourceName}</span>
          {embedName && (
            <span className="text-type-secondary text-xs">{embedName}</span>
          )}
        </Menu.ChevronLink>
        {/* Sub/Dub picker — only for anime (malId set).
            The anime stream category applies to the Zoko anime server. */}
        {isAnime && (
          <Menu.ChevronLink
            box
            onClick={() => router.navigate("/miroru")}
            rightText={miroruCategory}
          >
            {t("player.menus.miroru.linkItem")}
            <span className="text-type-secondary text-sm capitalize">
              {miroruCategory}
            </span>
          </Menu.ChevronLink>
        )}
        <Menu.ChevronLink
          box
          onClick={() => router.navigate("/captions")}
          rightText={sourceName}
        >
          {t("player.menus.settings.subtitleItem")}
          <span className="text-type-secondary text-sm">
            {selectedLanguagePretty ?? t("player.menus.subtitles.offChoice")}
          </span>
        </Menu.ChevronLink>
        {currentAudioTrack ? (
          <Menu.ChevronLink
            box
            onClick={() => router.navigate("/audio")}
            rightText={selectedAudioLanguagePretty ?? undefined}
          >
            {t("player.menus.settings.audioItem")}
            <span className="text-type-secondary text-sm">
              {selectedAudioLanguagePretty}
            </span>
          </Menu.ChevronLink>
        ) : (
          <Menu.ChevronLink
            box
            onClick={() => router.navigate("/audio")}
            disabled
          >
            {t("player.menus.settings.audioItem")}
            <span className="text-type-secondary text-sm">
              {t("player.menus.audio.default")}
            </span>
          </Menu.ChevronLink>
        )}
      </Menu.Section>
      <Menu.Section>
        <Menu.Link
          clickable
          onClick={() =>
            router.navigate(downloadable ? "/download" : "/download/unable")
          }
          rightSide={<Icon className="text-xl" icon={Icons.DOWNLOAD} />}
          className={downloadable ? "opacity-100" : "opacity-50"}
        >
          {t("player.menus.settings.downloadItem")}
        </Menu.Link>
                       {openInNewTabUrl && (
          <Menu.Link
            clickable
            onClick={() => {
              window.open(openInNewTabUrl, "_blank", "noreferrer");
            }}
            rightSide={<Icon className="text-xl" icon={Icons.LINK} />}
          >
            {t("player.menus.downloads.openInNewTab")}
          </Menu.Link>
        )}
        <Menu.Link
          clickable
          onClick={() =>
            router.navigate(downloadable ? "/watchparty" : "/download/unable")
          }
          rightSide={<Icon className="text-xl" icon={Icons.WATCH_PARTY} />}
          className={downloadable ? "opacity-100" : "opacity-50"}
        >
          {t("player.menus.watchparty.watchpartyItem")}
        </Menu.Link>
      </Menu.Section>
      <Menu.SectionTitle />
      <Menu.Section>
        <Menu.Link
          rightSide={
            <Toggle
              enabled={subtitlesEnabled}
              onClick={() => toggleLastUsed().catch(() => {})}
            />
          }
        >
          {t("player.menus.settings.enableSubtitles")}
        </Menu.Link>
        <Menu.ChevronLink onClick={() => router.navigate("/playback")}>
          {t("player.menus.settings.playbackItem")}
        </Menu.ChevronLink>
        <Menu.ChevronLink
          onClick={() => router.navigate("/playback/skip-segments")}
        >
          {t("player.skipTime.skipSegments")}
        </Menu.ChevronLink>
      </Menu.Section>
    </Menu.Card>
  );
}
