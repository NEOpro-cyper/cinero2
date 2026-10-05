import { useCallback, useEffect, useMemo, useRef } from "react";

import { usePlayerStore } from "@/stores/player/store";
import { useVolumeStore } from "@/stores/volume";

import { useCaptions } from "./useCaptions";

export function useInitializePlayer() {
  const display = usePlayerStore((s) => s.display);
  const volume = useVolumeStore((s) => s.volume);

  const init = useCallback(() => {
    display?.setVolume(volume);
  }, [display, volume]);

  return {
    init,
  };
}

export function useInitializeSource() {
  const source = usePlayerStore((s) => s.source);
  const sourceIdentifier = useMemo(
    () => (source ? JSON.stringify(source) : null),
    [source],
  );
  const { autoSelectCaption } = useCaptions();

  // Re-entrancy guard. autoSelectCaption's identity legitimately CHANGES
  // after it applies a caption: its useCallback dependency chain includes
  // the selected caption object (via selectCaptionById → setDirectCaption →
  // selectedCaption), and applying a caption stores a NEW object identity
  // in the player store. That re-fires this effect, which would re-select
  // the caption (now an instant cache hit), store ANOTHER new object, and
  // re-fire again — an infinite render/select loop that hard-freezes the
  // player at 100% CPU. Run auto-selection exactly once per source.
  const initializedSource = useRef<string | null>(null);

  useEffect(() => {
    if (sourceIdentifier && initializedSource.current !== sourceIdentifier) {
      initializedSource.current = sourceIdentifier;
      // autoSelectCaption fully supersedes selectLastUsedLanguageIfEnabled:
      //   - subtitles already enabled → re-select last used language/track
      //   - user explicitly disabled subs → do nothing (respect choice)
      //   - never touched subs → AUTO-ENABLE the best track the source
      //     provides (language match → source default-flag → first),
      //     e.g. the Zoko anime API's `default: true` English subtitle.
      autoSelectCaption().catch(() => {});
    }
  }, [sourceIdentifier, autoSelectCaption]);
}
