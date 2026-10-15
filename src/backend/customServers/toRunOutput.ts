/**
 * Bridge between the customServers module and the existing P-Stream
 * player pipeline (which expects a `RunOutput` from `@p-stream/providers`).
 *
 * We construct a synthetic `RunOutput` from a `ScrapeCustomServerResult`
 * so that `convertRunoutputToSource()` and `convertProviderCaption()`
 * can consume it without any changes.
 */

import type { RunOutput, Stream } from "@movie-web/providers";

import type { ScrapeCustomServerResult } from "./types";

type StreamCaption = Stream["captions"][number];

function toProviderCaptions(
  captions: ScrapeCustomServerResult["stream"]["captions"],
): StreamCaption[] {
  if (!captions) return [];
  return captions.map(
    (c) =>
      ({
        id: c.id,
        language: c.language,
        url: c.url,
        hasCorsRestrictions: c.hasCorsRestrictions ?? true,
        opensubtitles: false,
        // Pass-through extras for the caption list UI.
        type: c.type,
        display: c.display,
        // Default-flag from the source API (used by auto-subtitle pick).
        isDefault: c.isDefault,
      }) as unknown as StreamCaption,
  );
}

function pickHlsStream(result: ScrapeCustomServerResult): Stream {
  const s = result.stream;
  return {
    type: "hls",
    playlist: s.url!,
    headers: s.headers,
    preferredHeaders: s.preferredHeaders,
    captions: toProviderCaptions(s.captions),
  } as unknown as Stream;
}

function pickFileStream(result: ScrapeCustomServerResult): Stream {
  const s = result.stream;
  const qualities: Record<string, { type: "mp4"; url: string }> = {};
  if (s.qualities) {
    for (const q of s.qualities) {
      // P-Stream's `Qualities` type is "4k"|"1080"|"720"|"480"|"360"|"unknown".
      // We already normalized to that set in the adapter.
      qualities[q.quality] = { type: "mp4", url: q.url };
    }
  }
  return {
    type: "file",
    qualities: qualities as any,
    headers: s.headers,
    preferredHeaders: s.preferredHeaders,
    captions: toProviderCaptions(s.captions),
  } as unknown as Stream;
}

/**
 * Convert a custom-server scrape result into a synthetic RunOutput that
 * the rest of the P-Stream pipeline can consume via the existing
 * `convertRunoutputToSource` and `convertProviderCaption` helpers.
 */
export function customResultToRunOutput(
  result: ScrapeCustomServerResult,
): RunOutput {
  const stream =
    result.stream.type === "hls"
      ? pickHlsStream(result)
      : pickFileStream(result);
  return {
    sourceId: result.sourceId,
    stream,
    embeds: [],
  } as unknown as RunOutput;
}
