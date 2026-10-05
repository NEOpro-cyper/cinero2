import { useEffect, useRef } from "react";

import { conf } from "@/setup/config";
import { usePreferencesStore } from "@/stores/preferences";

/**
 * AdSlot
 * ───────────────────────────────────────────────────────────────────
 * Renders a named ad slot. The slot's script URL is looked up from
 * `conf().AD_SCRIPTS` (configured via `VITE_AD_SCRIPTS` in config.js).
 *
 * Behaviour:
 *   • Master toggle: `enableAds` in the preferences store. If false,
 *     nothing renders and no script is injected.
 *   • Per-slot toggle: `disabledAdSlots` in the preferences store. If
 *     the slot's name is in that list, nothing renders.
 *   • The script is appended to a container div on mount and removed
 *     on unmount, so toggling the preference cleanly loads/unloads it.
 *
 * ── Aggressive cleanup ────────────────────────────────────────────
 * Popunder ad networks (Terra, Poophub, etc.) install document-level
 * click/pointerdown listeners and inject hidden <iframe> + extra
 * <script> tags directly into <head>/<body> (NOT inside our container)
 * when their script runs. Our cleanup therefore also:
 *   1. Removes all <script> tags in head/body whose src matches the
 *      ad URL or starts with the ad network's origin.
 *   2. Removes all <iframe> elements in body (ad scripts use these
 *      for tracking pixels and popunder launching).
 *   3. Nullifies known ad library globals (window.terra, window.popns,
 *      window.popcash, window.exoApp, etc.) if present.
 *
 * NOTE: Even with all this, document-level event listeners installed
 * by the ad script CANNOT be removed without a reference to the
 * original handler. The AdsPart settings page therefore ALSO does a
 * full window.location.reload() after toggling — that's the only
 * reliable way to clear those listeners. The cleanup below is
 * defense-in-depth for cases where the reload is interrupted or the
 * user navigates away before it fires.
 *
 * Usage:
 *   <AdSlot slotName="terra" />
 *   <AdSlot slotName="tag" className="my-4" />
 *
 * Config example (config.js):
 *   VITE_AD_SCRIPTS:
 *     "terra|https://downyattainprojects.com/8e/b8/32/8eb832d6881025820b70493d89bee8ae.js,"
 *     + "tag|https://another.example/path.js"
 */

// Known ad-network global object names. Nullifying these (where
// present) breaks the ad library's ability to fire popunders after
// the script tag is removed.
const AD_GLOBALS = [
  "terra",
  "popns",
  "popcash",
  "exoApp",
  "exoloader",
  "popMagic",
  "popunder",
  "ad_idzone",
  "adcash",
  "propellerAds",
  "adsterra",
  "monetag",
  "pl_",
];

// Extract the origin (https://host) from a script URL so we can match
// any additional scripts the ad library injects from the same domain.
function urlOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

// Aggressively clean up after an ad script: remove matching <script>
// tags from head/body, remove iframes, nullify ad globals.
function aggressiveAdCleanup(adUrl: string) {
  const origin = urlOrigin(adUrl);

  // 1. Remove <script> tags in head and body whose src matches the
  //    ad URL or originates from the same ad network domain.
  const allScripts = document.querySelectorAll(
    "head script[src], body script[src]",
  );
  allScripts.forEach((node) => {
    const src = (node as HTMLScriptElement).src || "";
    if (!src) return;
    if (src === adUrl || (origin && src.startsWith(origin))) {
      try {
        node.parentNode?.removeChild(node);
      } catch {
        /* ignore */
      }
    }
  });

  // 2. Remove <iframe> elements in body that the ad script likely
  //    created. We can't always tell which iframes are ad-created
  //    vs. legitimate, so we only remove those that:
  //    - have no id (legit iframes usually have ids), OR
  //    - have an id/class containing "ad", "pop", "terra", "monetag"
  //    - AND were not present at page load (we'd need a baseline for
  //      that; instead, we use the heuristic above)
  const allIframes = document.querySelectorAll("body iframe");
  allIframes.forEach((node) => {
    const id = (node.id || "").toLowerCase();
    const cls = (node.className || "").toString().toLowerCase();
    const src = (node as HTMLIFrameElement).src || "";
    const looksAdRelated =
      !id ||
      /\b(ad|pop|terra|monetag|adcash|propeller|sterra)\b/.test(id) ||
      /\b(ad|pop|terra|monetag|adcash|propeller|sterra)\b/.test(cls) ||
      (origin && src.startsWith(origin));
    if (looksAdRelated) {
      try {
        node.parentNode?.removeChild(node);
      } catch {
        /* ignore */
      }
    }
  });

  // 3. Nullify known ad library globals so any lingering references
  //    can't fire popunders.
  AD_GLOBALS.forEach((name) => {
    try {
      // @ts-expect-error - dynamic global access
      if (window[name]) {
        // @ts-expect-error - dynamic global access
        window[name] = null;
      }
    } catch {
      /* ignore */
    }
  });
}

export function AdSlot({
  slotName,
  className,
}: {
  slotName: string;
  className?: string;
}): JSX.Element | null {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const enableAds = usePreferencesStore((s) => s.enableAds);
  const disabledAdSlots = usePreferencesStore((s) => s.disabledAdSlots);

  const slotConfig = conf().AD_SCRIPTS.find((s) => s.name === slotName);
  const isSlotDisabled = disabledAdSlots.includes(slotName);

  // If global ads are off, the slot is individually disabled, or the
  // slot isn't configured, render nothing.
  const shouldRender = Boolean(enableAds && !isSlotDisabled && slotConfig?.url);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !shouldRender || !slotConfig?.url) return;

    // Inject the ad script as a child <script> tag. Browsers only
    // execute scripts created via createElement — innerHTML/JSX won't.
    const script = document.createElement("script");
    script.src = slotConfig.url;
    script.async = true;
    // data attributes help ad scripts identify their slot
    script.dataset.adSlot = slotName;
    script.dataset.adUrl = slotConfig.url;

    // Some ad libraries look for a container with a specific id.
    container.id = `ad-slot-${slotName}`;

    container.appendChild(script);

    const adUrl = slotConfig.url;

    return () => {
      // Cleanup #1: remove the script and any DOM the ad script
      // injected into OUR container.
      try {
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }
      } catch {
        /* ignore */
      }

      // Cleanup #2: aggressive document-wide cleanup. The ad library
      // has injected scripts/iframes into head/body and installed
      // document-level event listeners. We strip the scripts and
      // iframes here; the document-level listeners require a page
      // reload to fully clear (handled by AdsPart on toggle).
      aggressiveAdCleanup(adUrl);
    };
  }, [shouldRender, slotName, slotConfig]);

  if (!shouldRender) return null;

  return (
    <div
      ref={containerRef}
      className={`ad-slot ad-slot-${slotName} ${className ?? ""}`.trim()}
      data-ad-slot={slotName}
    />
  );
}
