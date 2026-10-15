import { MetaOutput } from "@movie-web/providers";
import { jwtDecode } from "jwt-decode";

import { getCustomServerMetaList } from "@/backend/customServers";

let metaDataCache: MetaOutput[] | null = null;
let token: null | string = null;

/**
 * Bundled @movie-web/providers source IDs that don't work on this
 * deployment. They are filtered out of getCachedMetadata() so they
 * never appear in the player's source picker, AND filtered out of the
 * scrape order in useProviderScrape.tsx so they're never tried even
 * if the picker is bypassed (e.g. auto-scrape).
 *
 * Keep this list in sync with BLOCKED_BUNDLED_SOURCE_IDS in
 * src/hooks/useProviderScrape.tsx.
 */
const BLOCKED_BUNDLED_SOURCE_IDS = new Set([
  "8stream",
  "ee3",
  "streambox",
  "soapertv",
  "whvxMirrors",
  "2embed",
  "mp4hydra",
  "primewire",
  "hindiscraper",
]);

/**
 * Filter a list of provider source metadata to remove the broken
 * bundled sources. Use this anywhere that lists providers for UI
 * (source picker, preferences, settings, admin pages).
 */
export function filterBlockedBundledSources<T extends { id: string }>(
  list: T[],
): T[] {
  return list.filter((m) => !BLOCKED_BUNDLED_SOURCE_IDS.has(m.id));
}

export function setCachedMetadata(data: MetaOutput[]) {
  metaDataCache = data.filter(
    (m) => !BLOCKED_BUNDLED_SOURCE_IDS.has(m.id),
  );
}

/**
 * Returns the cached provider metadata, MERGED with the list of
 * custom API servers defined in `src/backend/customServers/config.ts`.
 *
 * Custom servers are appended at the END of the list so that any
 * source-order preferences saved by the user (which reference
 * provider source IDs) are not disrupted. Custom servers all have
 * IDs starting with `custom-`, so they're easy to detect downstream.
 */
export function getCachedMetadata(): MetaOutput[] {
  const base = (metaDataCache ?? []).filter(
    (m) => !BLOCKED_BUNDLED_SOURCE_IDS.has(m.id),
  );
  const customs = getCustomServerMetaList();
  if (customs.length === 0) return base;
  // Avoid duplicates (in case setCachedMetadata was called with customs already merged)
  const seen = new Set(base.map((m) => m.id));
  const merged = [...base];
  for (const c of customs) {
    if (!seen.has(c.id)) {
      merged.push(c);
      seen.add(c.id);
    }
  }
  return merged;
}

export function setApiToken(newToken: string) {
  token = newToken;
}

function getTokenIfValid(): null | string {
  if (!token) return null;
  try {
    const body = jwtDecode(token);
    if (!body.exp) return `jwt|${token}`;
    if (Date.now() / 1000 < body.exp) return `jwt|${token}`;
  } catch (err) {
    // we dont care about parse errors
  }
  return null;
}

export async function getApiToken(): Promise<string | null> {
  return getTokenIfValid();
}
