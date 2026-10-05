/**
 * ════════════════════════════════════════════════════════════════════════
 *  providersShim.ts
 * ════════════════════════════════════════════════════════════════════════
 *
 *  Local helpers that used to come from `@movie-web/providers` (a now-defunct
 *  fork of `@movie-web/providers`). `@movie-web/providers` does not export
 *  these, so we keep lightweight in-process implementations here.
 *
 *  - `setM3U8ProxyUrl(url)` — store the M3U8 proxy URL in module state. The
 *    p-stream fetcher wrapper reads this back when proxying HLS playlists.
 *  - `getM3U8ProxyUrl()` — return whatever was last set.
 *  - `labelToLanguageCode(label)` — best-effort English/ISO label → ISO 639-1
 *    conversion, used by caption importers (OpenSubtitles, Febbox, VDRK,
 *    Cinetaro, CaptionsView).
 *
 *  These functions are intentionally tiny and self-contained so the rest of
 *  the codebase can keep importing them with zero behavior change.
 * ════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────
// M3U8 proxy URL state
// ─────────────────────────────────────────────────────────────────────────

let _m3u8ProxyUrl = "";

/**
 * Set the M3U8 proxy URL used internally when proxying HLS playlists.
 * Pass an empty string to clear.
 */
export function setM3U8ProxyUrl(url: unknown): void {
  _m3u8ProxyUrl = typeof url === "string" ? url : "";
}

/**
 * Return the currently-configured M3U8 proxy URL (or "" if none).
 */
export function getM3U8ProxyUrl(): string {
  return _m3u8ProxyUrl;
}

// ─────────────────────────────────────────────────────────────────────────
// label → ISO 639-1 language code
// ─────────────────────────────────────────────────────────────────────────

const LANG_DB: Record<string, string> = {
  english: "en",
  en: "en",
  eng: "en",
  "english us": "en",
  "en-us": "en",
  "en-gb": "en",
  spanish: "es",
  espanol: "es",
  español: "es",
  es: "es",
  french: "fr",
  francais: "fr",
  français: "fr",
  fr: "fr",
  german: "de",
  deutsch: "de",
  de: "de",
  italian: "it",
  italiano: "it",
  it: "it",
  portuguese: "pt",
  português: "pt",
  pt: "pt",
  "pt-br": "pt-BR",
  "pt-pt": "pt-PT",
  russian: "ru",
  ру: "ru",
  руcский: "ru",
  ru: "ru",
  chinese: "zh",
  zh: "zh",
  "zh-cn": "zh-Hans",
  "zh-tw": "zh-Hant",
  japanese: "ja",
  ja: "ja",
  korean: "ko",
  ko: "ko",
  arabic: "ar",
  ar: "ar",
  hindi: "hi",
  hi: "hi",
  dutch: "nl",
  nederlands: "nl",
  nl: "nl",
  polish: "pl",
  polski: "pl",
  pl: "pl",
  turkish: "tr",
  tr: "tr",
  swedish: "sv",
  svenska: "sv",
  sv: "sv",
  norwegian: "no",
  norsk: "no",
  no: "no",
  danish: "da",
  dansk: "da",
  da: "da",
  finnish: "fi",
  suomi: "fi",
  fi: "fi",
  czech: "cs",
  cesky: "cs",
  čeština: "cs",
  cs: "cs",
  greek: "el",
  ελληνικά: "el",
  el: "el",
  hebrew: "he",
  he: "he",
  thai: "th",
  th: "th",
  indonesian: "id",
  indonesia: "id",
  id: "id",
  vietnamese: "vi",
  vi: "vi",
  romanian: "ro",
  romana: "ro",
  română: "ro",
  ro: "ro",
  hungarian: "hu",
  magyar: "hu",
  hu: "hu",
  ukrainian: "uk",
  uk: "uk",
  catalan: "ca",
  català: "ca",
  ca: "ca",
};

/**
 * Best-effort conversion of a free-form language label (English name,
 * native name, ISO 639-1, ISO 639-2/T, or ISO 639-3) into an ISO 639-1
 * two-letter code. Returns `undefined` if no mapping could be found.
 */
export function labelToLanguageCode(label: unknown): string | undefined {
  if (!label) return undefined;
  const lower = String(label).toLowerCase().trim();
  if (!lower) return undefined;
  if (LANG_DB[lower]) return LANG_DB[lower];
  // Try the first sub-token ("English (US)" → "english")
  const first = lower.split(/[\s._\-()]/)[0];
  if (first && LANG_DB[first]) return LANG_DB[first];
  // Direct 2-char ISO 639-1
  if (/^[a-z]{2}$/.test(first)) return first;
  // Truncate 3-char ISO 639-2/3 → 2-char (best-effort)
  if (/^[a-z]{3}$/.test(first)) return first.slice(0, 2);
  return undefined;
}
