import { useTranslation } from "react-i18next";

import { Toggle } from "@/components/buttons/Toggle";
import { Heading1 } from "@/components/utils/Text";
import { usePreferencesStore } from "@/stores/preferences";

/**
 * AdsPart
 * ───────────────────────────────────────────────────────────────────
 * Settings section for the ad system.
 *
 * There is ONE single global toggle that turns ALL ads on or off at
 * once — no per-slot toggles. The choice is saved per-browser in
 * localStorage (via zustand-persist), which means:
 *
 *   • Works for BOTH registered AND guest (unregistered) users.
 *   • Each user's choice only affects THEIR OWN browser.
 *   • One user turning ads off does NOT affect any other user.
 *
 * When ads are OFF, no ad scripts are loaded and no ad slots render,
 * regardless of what is configured in VITE_AD_SCRIPTS.
 *
 * ── Why we reload the page on toggle ──────────────────────────────
 * Popunder ad networks (Terra, Poophub, etc.) install document-level
 * click/pointerdown/mousedown listeners when their script first runs.
 * These listeners intercept ANY click on the page and open a popunder.
 *
 * When the user toggles ads OFF, we can remove the <script> tag we
 * injected, but the JavaScript has ALREADY executed — its event
 * listeners on document/window are still active. JavaScript has no
 * way to enumerate or remove listeners added by another script
 * without a reference to the original handler.
 *
 * The ONLY reliable way to clear those listeners (and any hidden
 * iframes / global state the ad library installed) is to reload the
 * page. We persist the new preference first, then reload after a
 * short delay so the new state takes effect cleanly.
 */
export function AdsPart() {
  const { t } = useTranslation();

  const enableAds = usePreferencesStore((s) => s.enableAds);
  const setEnableAds = usePreferencesStore((s) => s.setEnableAds);

  const handleToggle = () => {
    const newValue = !enableAds;
    // Persist the new value to localStorage first.
    setEnableAds(newValue);
    // Reload the page so any ad scripts that were previously loaded
    // are fully cleared (event listeners, iframes, global state).
    // Without the reload, popunder click listeners installed by the
    // ad script would keep firing even after the script tag is removed.
    setTimeout(() => {
      window.location.reload();
    }, 150);
  };

  return (
    <div className="space-y-8">
      <Heading1 border>{t("settings.ads.title")}</Heading1>

      {/* Single global ON/OFF toggle for ALL ads */}
      <div>
        <p className="text-white font-bold mb-3">
          {t("settings.ads.enable.title")}
        </p>
        <p className="max-w-[25rem] font-medium">
          {t("settings.ads.enable.description")}
        </p>
        <div
          onClick={handleToggle}
          className="bg-dropdown-background hover:bg-dropdown-hoverBackground select-none my-4 cursor-pointer space-x-3 flex items-center max-w-[25rem] py-3 px-4 rounded-lg"
        >
          <Toggle enabled={enableAds} />
          <p className="flex-1 text-white font-bold">
            {t("settings.ads.enable.label")}
          </p>
        </div>

        {/* Helper note explaining per-browser behaviour */}
        <p className="max-w-[25rem] text-xs text-type-dimmed mt-2">
          {t("settings.ads.enable.note")}
        </p>

        {/* Explanation that the page will reload on toggle */}
        <p className="max-w-[25rem] text-xs text-type-dimmed mt-1">
          {enableAds
            ? "Toggling ads off will reload the page to clear any active ad scripts."
            : "Toggling ads on will reload the page to load the ad scripts."}
        </p>
      </div>
    </div>
  );
}
