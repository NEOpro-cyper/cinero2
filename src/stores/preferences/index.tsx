import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  KeyboardShortcuts,
} from "@/utils/keyboardShortcuts";

export interface PreferencesStore {
  enableThumbnails: boolean;
  enableAutoplay: boolean;
  enableSkipCredits: boolean;
  enableAutoSkipSegments: boolean;
  enableDiscover: boolean;
  enableFeatured: boolean;
  enableDetailsModal: boolean;
  enableImageLogos: boolean;
  enableCarouselView: boolean;
  enableMinimalCards: boolean;
  forceCompactEpisodeView: boolean;
  sourceOrder: string[];
  enableSourceOrder: boolean;
  lastSuccessfulSource: string | null;
  enableLastSuccessfulSource: boolean;
  embedOrder: string[];
  enableEmbedOrder: boolean;
  proxyTmdb: boolean;
  febboxKey: string | null;
  febboxUseMp4: boolean;
  debridToken: string | null;
  debridService: string;
  tidbKey: string | null;
  enableLowPerformanceMode: boolean;
  enableNativeSubtitles: boolean;
  enableHoldToBoost: boolean;
  homeSectionOrder: string[];
  manualSourceSelection: boolean;
  enableDoubleClickToSeek: boolean;
  enableAutoResumeOnPlaybackError: boolean;
  enableNumberKeySeeking: boolean;
  enablePauseOverlay: boolean;
  enableAds: boolean;
  disabledAdSlots: string[];
  keyboardShortcuts: KeyboardShortcuts;
  // ── Miroru (anime) ──
  // Miroru server name (one of: bonk, pewe, moo, bee, kiwi, hop, ally).
  // Only used when the current media is anime (anilist-* URL).
  miroruServer: string;
  // Sub vs Dub. Miroru exposes two endpoints per episode:
  //   /api/{id}/{ep}/sub?server=X
  //   /api/{id}/{ep}/dub?server=X
  miroruCategory: "sub" | "dub";

  setEnableThumbnails(v: boolean): void;
  setEnableAutoplay(v: boolean): void;
  setEnableSkipCredits(v: boolean): void;
  setEnableAutoSkipSegments(v: boolean): void;
  setEnableDiscover(v: boolean): void;
  setEnableFeatured(v: boolean): void;
  setEnableDetailsModal(v: boolean): void;
  setEnableImageLogos(v: boolean): void;
  setEnableCarouselView(v: boolean): void;
  setEnableMinimalCards(v: boolean): void;
  setForceCompactEpisodeView(v: boolean): void;
  setSourceOrder(v: string[]): void;
  setEnableSourceOrder(v: boolean): void;
  setLastSuccessfulSource(v: string | null): void;
  setEnableLastSuccessfulSource(v: boolean): void;
  setEmbedOrder(v: string[]): void;
  setEnableEmbedOrder(v: boolean): void;
  setProxyTmdb(v: boolean): void;
  setFebboxKey(v: string | null): void;
  setFebboxUseMp4(v: boolean): void;
  setdebridToken(v: string | null): void;
  setdebridService(v: string): void;
  setTIDBKey(v: string | null): void;
  setEnableLowPerformanceMode(v: boolean): void;
  setEnableNativeSubtitles(v: boolean): void;
  setEnableHoldToBoost(v: boolean): void;
  setHomeSectionOrder(v: string[]): void;
  setManualSourceSelection(v: boolean): void;
  setEnableDoubleClickToSeek(v: boolean): void;
  setEnableAutoResumeOnPlaybackError(v: boolean): void;
  setEnableNumberKeySeeking(v: boolean): void;
  setEnablePauseOverlay(v: boolean): void;
  setEnableAds(v: boolean): void;
  setDisabledAdSlots(v: string[]): void;
  toggleAdSlot(name: string): void;
  setKeyboardShortcuts(v: KeyboardShortcuts): void;
  setMiroruServer(v: string): void;
  setMiroruCategory(v: "sub" | "dub"): void;
}

export const usePreferencesStore = create(
  persist(
    immer<PreferencesStore>((set) => ({
      enableThumbnails: false,
      enableAutoplay: true,
      enableSkipCredits: true,
      enableAutoSkipSegments: false,
      enableDiscover: true,
      enableFeatured: false,
      enableDetailsModal: false,
      enableImageLogos: true,
      enableCarouselView: false,
      enableMinimalCards: false,
      forceCompactEpisodeView: false,
      sourceOrder: [],
      enableSourceOrder: false,
      lastSuccessfulSource: null,
      enableLastSuccessfulSource: false,
      embedOrder: [],
      enableEmbedOrder: false,
      proxyTmdb: false,
      febboxKey: null,
      febboxUseMp4: false,
      debridToken: null,
      debridService: "realdebrid",
      tidbKey: null,
      enableLowPerformanceMode: false,
      enableNativeSubtitles: false,
      enableHoldToBoost: true,
      homeSectionOrder: ["watching", "bookmarks"],
      manualSourceSelection: false,
      enableDoubleClickToSeek: false,
      enableAutoResumeOnPlaybackError: true,
      enableNumberKeySeeking: true,
      enablePauseOverlay: false,
      enableAds: true,
      disabledAdSlots: [],
      keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
      // Default to "kiwi" + "sub" — matches the previous hardcoded values.
      miroruServer: "kiwi",
      miroruCategory: "sub",
      setEnableThumbnails(v) {
        set((s) => {
          s.enableThumbnails = v;
        });
      },
      setEnableAutoplay(v) {
        set((s) => {
          s.enableAutoplay = v;
        });
      },
      setEnableSkipCredits(v) {
        set((s) => {
          s.enableSkipCredits = v;
        });
      },
      setEnableAutoSkipSegments(v) {
        set((s) => {
          s.enableAutoSkipSegments = v;
        });
      },
      setEnableDiscover(v) {
        set((s) => {
          s.enableDiscover = v;
        });
      },
      setEnableFeatured(v) {
        set((s) => {
          s.enableFeatured = v;
        });
      },
      setEnableDetailsModal(v) {
        set((s) => {
          s.enableDetailsModal = v;
        });
      },
      setEnableImageLogos(v) {
        set((s) => {
          s.enableImageLogos = v;
        });
      },
      setEnableCarouselView(v) {
        set((s) => {
          s.enableCarouselView = v;
        });
      },
      setEnableMinimalCards(v) {
        set((s) => {
          s.enableMinimalCards = v;
        });
      },
      setForceCompactEpisodeView(v) {
        set((s) => {
          s.forceCompactEpisodeView = v;
        });
      },
      setSourceOrder(v) {
        set((s) => {
          s.sourceOrder = v;
        });
      },
      setEnableSourceOrder(v) {
        set((s) => {
          s.enableSourceOrder = v;
        });
      },
      setLastSuccessfulSource(v) {
        set((s) => {
          s.lastSuccessfulSource = v;
        });
      },
      setEnableLastSuccessfulSource(v) {
        set((s) => {
          s.enableLastSuccessfulSource = v;
        });
      },
      setEmbedOrder(v) {
        set((s) => {
          s.embedOrder = v;
        });
      },
      setEnableEmbedOrder(v) {
        set((s) => {
          s.enableEmbedOrder = v;
        });
      },
      setProxyTmdb(v) {
        set((s) => {
          s.proxyTmdb = v;
        });
      },
      setFebboxKey(v) {
        set((s) => {
          s.febboxKey = v;
        });
      },
      setFebboxUseMp4(v) {
        set((s) => {
          s.febboxUseMp4 = v;
        });
      },
      setdebridToken(v) {
        set((s) => {
          s.debridToken = v;
        });
      },
      setdebridService(v) {
        set((s) => {
          s.debridService = v;
        });
      },
      setTIDBKey(v) {
        set((s) => {
          s.tidbKey = v;
        });
      },
      setEnableLowPerformanceMode(v) {
        set((s) => {
          s.enableLowPerformanceMode = v;
          // When enabling performance mode, disable bandwidth-heavy features
          if (v) {
            s.enableThumbnails = false;
            s.enableAutoplay = false;
          }
        });
      },
      setEnableNativeSubtitles(v) {
        set((s) => {
          s.enableNativeSubtitles = v;
        });
      },
      setEnableHoldToBoost(v) {
        set((s) => {
          s.enableHoldToBoost = v;
        });
      },
      setHomeSectionOrder(v) {
        set((s) => {
          s.homeSectionOrder = v.length > 0 ? v : ["watching", "bookmarks"];
        });
      },
      setManualSourceSelection(v) {
        set((s) => {
          s.manualSourceSelection = v;
        });
      },
      setEnableDoubleClickToSeek(v) {
        set((s) => {
          s.enableDoubleClickToSeek = v;
        });
      },
      setEnableAutoResumeOnPlaybackError(v) {
        set((s) => {
          s.enableAutoResumeOnPlaybackError = v;
        });
      },
      setEnableNumberKeySeeking(v) {
        set((s) => {
          s.enableNumberKeySeeking = v;
        });
      },
      setEnablePauseOverlay(v) {
        set((s) => {
          s.enablePauseOverlay = v;
        });
      },
      setEnableAds(v) {
        set((s) => {
          s.enableAds = v;
        });
      },
      // NOTE: per-slot toggles were removed from the UI in favour of a
      // single global ON/OFF switch. These setters are kept only so that
      // older persisted state (saved by previous versions) doesn't crash
      // when rehydrated. They are no longer called from anywhere.
      setDisabledAdSlots(v) {
        set((s) => {
          s.disabledAdSlots = Array.isArray(v) ? v : [];
        });
      },
      toggleAdSlot(name) {
        set((s) => {
          if (s.disabledAdSlots.includes(name)) {
            s.disabledAdSlots = s.disabledAdSlots.filter((n) => n !== name);
          } else {
            s.disabledAdSlots = [...s.disabledAdSlots, name];
          }
        });
      },
      setKeyboardShortcuts(v) {
        set((s) => {
          s.keyboardShortcuts = v;
        });
      },
      setMiroruServer(v) {
        set((s) => {
          s.miroruServer = v;
        });
      },
      setMiroruCategory(v) {
        set((s) => {
          s.miroruCategory = v;
        });
      },
    })),
    {
      name: "__MW::preferences",
    },
  ),
);
