import { useCallback, useEffect, useMemo } from "react";
import subsrt from "subsrt-ts";

import { downloadCaption, downloadWebVTT } from "@/backend/helpers/subs";
import {
  filterDuplicateCaptionCues,
  parseVttSubtitles,
} from "@/components/utils/captions";
import { Caption, CaptionListItem } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { usePreferencesStore } from "@/stores/preferences";
import { useSubtitleStore } from "@/stores/subtitles";

/**
 * Normalize a language tag/label to a bare ISO-ish code so API-provided
 * subtitles match the stored preference even when spellings differ:
 * "en-US" / "eng" / "English" → "en", "jpn" / "Japanese" → "ja", ...
 */
function normalizeLang(lang?: string | null): string {
  if (!lang) return "";
  const base = lang.toLowerCase().trim().split(/[-_]/)[0];
  const aliases: Record<string, string> = {
    eng: "en",
    english: "en",
    jpn: "ja",
    jp: "ja",
    japanese: "ja",
    spa: "es",
    spanish: "es",
    esp: "es",
    fra: "fr",
    fre: "fr",
    french: "fr",
    deu: "de",
    ger: "de",
    german: "de",
    ita: "it",
    italian: "it",
    por: "pt",
    portuguese: "pt",
    rus: "ru",
    russian: "ru",
    ara: "ar",
    arabic: "ar",
    kor: "ko",
    korean: "ko",
    zho: "zh",
    chi: "zh",
    chinese: "zh",
    ptbr: "pt",
    "pt-br": "pt",
  };
  return aliases[base] ?? base;
}

/** Wait until the active source exposes at least one caption track
 *  (external caption lists arrive with setSource; HLS-embedded tracks
 *  only appear once hls.js has parsed the manifest). */
async function waitForCaptions(
  maxMs = 5000,
  intervalMs = 400,
): Promise<CaptionListItem[]> {
  const deadline = Date.now() + maxMs;
  for (;;) {
    const state = usePlayerStore.getState();
    const list =
      state.captionList.length !== 0
        ? state.captionList
        : (state.display?.getCaptionList?.() ?? []);
    if (list.length > 0 || Date.now() >= deadline) return list;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export function useCaptions() {
  const setSubtitle = useSubtitleStore((s) => s.setSubtitle);
  const enabled = useSubtitleStore((s) => s.enabled);
  const userDisabled = useSubtitleStore((s) => s.userDisabled);
  const resetSubtitleSpecificSettings = useSubtitleStore(
    (s) => s.resetSubtitleSpecificSettings,
  );
  const setCaption = usePlayerStore((s) => s.setCaption);
  const currentTranslateTask = usePlayerStore((s) => s.caption.translateTask);
  const lastSelectedLanguage = useSubtitleStore((s) => s.lastSelectedLanguage);
  const lastSelectedSubtitleId = useSubtitleStore(
    (s) => s.lastSelectedSubtitleId,
  );
  const setIsOpenSubtitles = useSubtitleStore((s) => s.setIsOpenSubtitles);

  const captionList = usePlayerStore((s) => s.captionList);
  const getHlsCaptionList = usePlayerStore((s) => s.display?.getCaptionList);
  const source = usePlayerStore((s) => s.source);
  const selectedCaption = usePlayerStore((s) => s.caption.selected);

  const getSubtitleTracks = usePlayerStore((s) => s.display?.getSubtitleTracks);
  const setSubtitlePreference = usePlayerStore(
    (s) => s.display?.setSubtitlePreference,
  );
  const setCaptionAsTrack = usePlayerStore((s) => s.setCaptionAsTrack);
  const enableNativeSubtitles = usePreferencesStore(
    (s) => s.enableNativeSubtitles,
  );

  const captions = useMemo(
    () =>
      captionList.length !== 0 ? captionList : (getHlsCaptionList?.() ?? []),
    [captionList, getHlsCaptionList],
  );

  const setDirectCaption = useCallback(
    (caption: Caption, listItem: CaptionListItem) => {
      setIsOpenSubtitles(!!listItem.opensubtitles);
      setCaption(caption);

      // Only reset subtitle settings if selecting a different caption
      if (selectedCaption?.id !== caption.id) {
        resetSubtitleSpecificSettings();
      }

      setSubtitle(true, caption.language, caption.id);

      // Use native tracks for MP4 streams instead of custom rendering
      if (source?.type === "file" && enableNativeSubtitles) {
        setCaptionAsTrack(true);
      } else {
        // For HLS sources or when native subtitles are disabled, use custom rendering
        setCaptionAsTrack(false);
      }
    },
    [
      setIsOpenSubtitles,
      setSubtitle,
      setCaption,
      resetSubtitleSpecificSettings,
      source,
      setCaptionAsTrack,
      enableNativeSubtitles,
      selectedCaption,
    ],
  );

  const selectCaptionById = useCallback(
    async (captionId: string) => {
      const caption = captions.find((v) => v.id === captionId);
      if (!caption) return;

      // No-op when this exact track is already applied. Re-applying would
      // setCaption() a brand-new object every call, churning the store
      // identity for zero benefit — which feeds re-entrant selection loops
      // (auto-select effect → new caption object → new callback identities →
      // effect refires → ...) and hard-freezes the player.
      if (
        selectedCaption?.id === caption.id &&
        (caption.hls || selectedCaption.srtData !== "")
      ) {
        return;
      }

      const captionToSet: Caption = {
        id: caption.id,
        language: caption.language,
        url: caption.url,
        srtData: "",
      };

      if (!caption.hls) {
        const srtData = await downloadCaption(caption);
        captionToSet.srtData = srtData;
      } else {
        // request a language change to hls, so it can load the subtitles
        await setSubtitlePreference?.(caption.language);
        const track = getSubtitleTracks?.().find(
          (t) => t.id.toString() === caption.id && t.details !== undefined,
        );
        if (!track) return;

        const fragments =
          track.details?.fragments?.filter(
            (frag) => frag !== null && frag.url !== null,
          ) ?? [];

        const vttCaptions = (
          await Promise.all(
            fragments.map(async (frag) => {
              const vtt = await downloadWebVTT(frag.url);
              return parseVttSubtitles(vtt);
            }),
          )
        ).flat();

        const filtered = filterDuplicateCaptionCues(vttCaptions);

        const srtData = subsrt.build(filtered, { format: "srt" });
        captionToSet.srtData = srtData;
      }

      setDirectCaption(captionToSet, caption);
    },
    [
      captions,
      selectedCaption,
      getSubtitleTracks,
      setSubtitlePreference,
      setDirectCaption,
    ],
  );

  const selectLanguage = useCallback(
    async (language: string) => {
      // Fuzzy language match so API-provided tracks labelled "English",
      // "eng" or "en-US" still match a stored preference of "en".
      // Tracks flagged as default by the source win within a language.
      const lang = normalizeLang(language);
      const caption =
        captions.find(
          (v) => v.isDefault && normalizeLang(v.language) === lang,
        ) ?? captions.find((v) => normalizeLang(v.language) === lang);
      if (!caption) return;
      return selectCaptionById(caption.id);
    },
    [captions, selectCaptionById],
  );

  const disable = useCallback(async () => {
    setIsOpenSubtitles(false);
    setCaption(null);
    setSubtitle(false);
  }, [setCaption, setSubtitle, setIsOpenSubtitles]);

  const selectLastUsedLanguage = useCallback(async () => {
    if (lastSelectedSubtitleId) {
      const caption = captions.find((v) => v.id === lastSelectedSubtitleId);
      if (caption) return selectCaptionById(caption.id);
    }

    const language = lastSelectedLanguage ?? "en";
    await selectLanguage(language);
    return true;
  }, [
    lastSelectedLanguage,
    selectLanguage,
    lastSelectedSubtitleId,
    captions,
    selectCaptionById,
  ]);

  const toggleLastUsed = useCallback(async () => {
    if (enabled) disable();
    else await selectLastUsedLanguage();
  }, [selectLastUsedLanguage, disable, enabled]);

  const selectLastUsedLanguageIfEnabled = useCallback(async () => {
    if (enabled) await selectLastUsedLanguage();
  }, [selectLastUsedLanguage, enabled]);

  /**
   * Auto-pick a subtitle when a new source starts playing.
   *
   * - Subtitles already enabled → keep previous behavior: select the
   *   last used language (fuzzy matched, default track preferred).
   * - User explicitly turned subtitles off → respect that, do nothing.
   * - Otherwise (fresh user / never touched subtitle settings) →
   *   AUTO-ENABLE the best subtitle the source itself provides:
   *   last used language → English → the stream's default-flagged
   *   track (e.g. zoko `default: true`) → first available. If a track
   *   fails to download, the next candidate is tried automatically.
   */
  const autoSelectCaption = useCallback(async () => {
    if (enabled) {
      // .catch: a failed download must not surface as an unhandled
      // rejection when the effect fired us without awaiting.
      await selectLastUsedLanguage().catch(() => {});
      return;
    }
    if (userDisabled) return;

    const list = await waitForCaptions();
    if (list.length === 0) return;

    const target = normalizeLang(lastSelectedLanguage ?? "en");
    const inTargetLang = list.filter(
      (c) => normalizeLang(c.language) === target,
    );
    const candidates = [
      ...inTargetLang.filter((c) => c.isDefault),
      ...inTargetLang,
      ...list.filter((c) => c.isDefault),
      ...list,
    ];

    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      try {
        await selectCaptionById(candidate.id);
        return; // selected — subtitles now auto-enabled for this source
      } catch {
        // download/parsing failed for this track — try the next one
      }
    }
  }, [
    enabled,
    userDisabled,
    lastSelectedLanguage,
    selectLastUsedLanguage,
    selectCaptionById,
  ]);

  const selectRandomCaptionFromLastUsedLanguage = useCallback(async () => {
    const language = lastSelectedLanguage ?? "en";

    // Filter captions by language
    const languageCaptions = captions.filter(
      (caption) => caption.language === language,
    );

    // If no captions exist for that language, return early
    if (languageCaptions.length === 0) return;

    // Filter out the currently selected caption if possible
    const availableCaptions = languageCaptions.filter(
      (caption) => caption.id !== selectedCaption?.id,
    );

    // If we filtered out all captions (only one caption available), use all captions
    const captionsToChooseFrom =
      availableCaptions.length > 0 ? availableCaptions : languageCaptions;

    // Pick a random caption
    const randomIndex = Math.floor(Math.random() * captionsToChooseFrom.length);
    const randomCaption = captionsToChooseFrom[randomIndex];

    // Select the random caption
    await selectCaptionById(randomCaption.id);
  }, [lastSelectedLanguage, captions, selectedCaption, selectCaptionById]);

  // Validate selected caption when caption list changes
  useEffect(() => {
    if (!selectedCaption) return;

    // Skip validation for custom/pasted captions that aren't in the caption list
    const isCustomCaption =
      selectedCaption.id === "custom-caption" ||
      selectedCaption.id === "pasted-caption";

    if (isCustomCaption) return;

    const isSelectedCaptionStillAvailable = captions.some(
      (caption) =>
        caption.id ===
        (currentTranslateTask
          ? currentTranslateTask.targetCaption
          : selectedCaption
        ).id,
    );

    if (!isSelectedCaptionStillAvailable) {
      // Try to find a caption with the same language
      const sameLanguageCaption = captions.find(
        (caption) =>
          caption.language ===
          (currentTranslateTask
            ? currentTranslateTask.targetCaption
            : selectedCaption
          ).language,
      );

      if (sameLanguageCaption) {
        // Automatically select the first caption with the same language
        selectCaptionById(sameLanguageCaption.id);
      } else {
        // No caption with the same language found, clear the selection
        setCaption(null);
      }
    }
  }, [
    captions,
    selectedCaption,
    setCaption,
    selectCaptionById,
    currentTranslateTask,
  ]);

  return {
    selectLanguage,
    disable,
    selectLastUsedLanguage,
    toggleLastUsed,
    selectLastUsedLanguageIfEnabled,
    autoSelectCaption,
    setDirectCaption,
    selectCaptionById,
    selectRandomCaptionFromLastUsedLanguage,
  };
}
