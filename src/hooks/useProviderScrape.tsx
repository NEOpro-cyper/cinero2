import {
  FullScraperEvents,
  RunOutput,
  ScrapeMedia,
} from "@movie-web/providers";
import { RefObject, useCallback, useEffect, useRef, useState } from "react";

import {
  SERVERS,
  customServerId,
  isCustomServerId,
  scrapeCustomServerByMedia,
} from "@/backend/customServers";
import { isServerApplicableForMedia } from "@/backend/customServers/fetcher";
import { customResultToRunOutput } from "@/backend/customServers/toRunOutput";
import { isExtensionActiveCached } from "@/backend/extension/messaging";
import { prepareStream } from "@/backend/extension/streams";
import { getCachedMetadata } from "@/backend/helpers/providerApi";
import { getProviders } from "@/backend/providers/providers";
import { getMediaKey } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { usePreferencesStore } from "@/stores/preferences";

export interface ScrapingItems {
  id: string;
  children: string[];
}

/**
 * Bundled @movie-web/providers source IDs that are BROKEN / not useful
 * on this deployment but still show up in the player's source picker
 * for movies and TV shows. We filter them out so the user only sees
 * sources that actually work (the custom servers in config.ts:
 * Armor / Kuro / Tiki / Atlas for movies & shows, Miroru for anime).
 *
 * These IDs come from the @movie-web/providers library v2.4.13 —
 * verified present in the production bundle (vendor-*.js).
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

export interface ScrapingSegment {
  name: string;
  id: string;
  embedId?: string;
  status: "failure" | "pending" | "notfound" | "success" | "waiting";
  reason?: string;
  error?: any;
  percentage: number;
}

type ScraperEvent<Event extends keyof FullScraperEvents> = Parameters<
  NonNullable<FullScraperEvents[Event]>
>[0];

function useBaseScrape() {
  const [sources, setSources] = useState<Record<string, ScrapingSegment>>({});
  const [sourceOrder, setSourceOrder] = useState<ScrapingItems[]>([]);
  const [currentSource, setCurrentSource] = useState<string>();
  const lastId = useRef<string | null>(null);

  const initEvent = useCallback((evt: ScraperEvent<"init">) => {
    setSources(
      evt.sourceIds
        .map((v) => {
          const source = getCachedMetadata().find((s) => s.id === v);
          // Don't throw on unknown source IDs — the @movie-web/providers
          // library's runAll() uses sourceOrder for SORTING, not filtering,
          // so it can still pass blocked/removed IDs (e.g. 8stream, ee3,
          // streambox, soapertv, whvxMirrors, 2embed, mp4hydra, primewire,
          // hindiscraper) through init. Skip them gracefully instead.
          if (!source) return null;
          const out: ScrapingSegment = {
            name: source.name,
            id: source.id,
            status: "waiting",
            percentage: 0,
          };
          return out;
        })
        .filter((s): s is ScrapingSegment => s !== null)
        .reduce<Record<string, ScrapingSegment>>((a, v) => {
          a[v.id] = v;
          return a;
        }, {}),
    );
    setSourceOrder(evt.sourceIds.map((v) => ({ id: v, children: [] })));
  }, []);

  const startEvent = useCallback((id: ScraperEvent<"start">) => {
    const lastIdTmp = lastId.current;
    setSources((s) => {
      if (s[id]) s[id].status = "pending";
      if (lastIdTmp && s[lastIdTmp] && s[lastIdTmp].status === "pending")
        s[lastIdTmp].status = "success";
      return { ...s };
    });
    setCurrentSource(id);
    lastId.current = id;
  }, []);

  const updateEvent = useCallback((evt: ScraperEvent<"update">) => {
    setSources((s) => {
      if (s[evt.id]) {
        s[evt.id].status = evt.status;
        s[evt.id].reason = evt.reason;
        s[evt.id].error = evt.error;
        s[evt.id].percentage = evt.percentage;
      }
      return { ...s };
    });
  }, []);

  const discoverEmbedsEvent = useCallback(
    (evt: ScraperEvent<"discoverEmbeds">) => {
      setSources((s) => {
        evt.embeds.forEach((v) => {
          const source = getCachedMetadata().find(
            (src) => src.id === v.embedScraperId,
          );
          // Skip unknown embed source IDs instead of throwing — see comment in initEvent.
          if (!source) return;
          const out: ScrapingSegment = {
            embedId: v.embedScraperId,
            name: source.name,
            id: v.id,
            status: "waiting",
            percentage: 0,
          };
          s[v.id] = out;
        });
        return { ...s };
      });
      setSourceOrder((s) => {
        const source = s.find((v) => v.id === evt.sourceId);
        // Skip if source not found — see comment in initEvent.
        if (!source) return s;
        source.children = evt.embeds.map((v) => v.id);
        return [...s];
      });
    },
    [],
  );

  const startScrape = useCallback(() => {
    lastId.current = null;
  }, []);

  const getResult = useCallback((output: RunOutput | null) => {
    if (output && lastId.current) {
      setSources((s) => {
        if (!lastId.current) return s;
        if (s[lastId.current]) s[lastId.current].status = "success";
        return { ...s };
      });
    }
    return output;
  }, []);

  return {
    initEvent,
    startEvent,
    updateEvent,
    discoverEmbedsEvent,
    startScrape,
    getResult,
    sources,
    sourceOrder,
    currentSource,
  };
}

export function useScrape() {
  const {
    sources,
    sourceOrder,
    currentSource,
    updateEvent,
    discoverEmbedsEvent,
    initEvent,
    getResult,
    startEvent,
    startScrape,
  } = useBaseScrape();

  const preferredSourceOrder = usePreferencesStore((s) => s.sourceOrder);
  const enableSourceOrder = usePreferencesStore((s) => s.enableSourceOrder);
  const lastSuccessfulSource = usePreferencesStore(
    (s) => s.lastSuccessfulSource,
  );
  const enableLastSuccessfulSource = usePreferencesStore(
    (s) => s.enableLastSuccessfulSource,
  );
  const preferredEmbedOrder = usePreferencesStore((s) => s.embedOrder);
  const enableEmbedOrder = usePreferencesStore((s) => s.enableEmbedOrder);
  // Sub/Dub category (anime only). Read from preferences so the
  // user can change it via the player settings overlay.
  const miroruCategory = usePreferencesStore((s) => s.miroruCategory);

  const startScraping = useCallback(
    async (media: ScrapeMedia, startFromSourceId?: string) => {
      const providerInstance = getProviders();
      const allSources = providerInstance.listSources();
      const playerState = usePlayerStore.getState();

      // Get media-specific failed sources/embeds
      // Try to get media key from player state first, fallback to deriving from ScrapeMedia
      let mediaKey = getMediaKey(playerState.meta);
      if (!mediaKey) {
        // Derive media key from ScrapeMedia if meta is not set yet
        if (media.type === "movie") {
          mediaKey = `movie-${media.tmdbId}`;
        } else if (media.type === "show" && media.season && media.episode) {
          mediaKey = `show-${media.tmdbId}-${media.season.tmdbId}-${media.episode.tmdbId}`;
        } else if (media.type === "show") {
          mediaKey = `show-${media.tmdbId}`;
        }
      }
      const failedSources = mediaKey
        ? playerState.failedSourcesPerMedia[mediaKey] || []
        : [];
      const failedEmbeds = mediaKey
        ? playerState.failedEmbedsPerMedia[mediaKey] || {}
        : {};

      // ── Custom API servers ─────────────────────────────────
      // Build the list of custom source IDs (e.g. "custom-hable").
      // These are tried FIRST during auto-scrape, before any of the
      // bundled providers. If any of them succeeds, we short-circuit
      // and return the result immediately.
      //
      // Each server declares which media types it supports via
      // `mediaTypes` (defaults to ["movie", "show"]). For anime media
      // (URL pattern: /media/anilist-<id>-<slug>), only anime-tagged
      // servers (Zoko) are kept — the movie/show servers are skipped
      // because they don't understand anime ids.
      const malId = playerState.meta?.malId;
      const isAnime = !!malId;
      const customIds = SERVERS.filter((s) =>
        isServerApplicableForMedia(s, {
          type: media.type as any,
          tmdbId: media.tmdbId,
          malId,
        } as Parameters<typeof isServerApplicableForMedia>[1]),
      ).map((s) => customServerId(s));

      // Start with all available sources, filtered by:
      //   - the blocklist of broken bundled providers (8stream, ee3,
      //     streambox, soapertv, whvxMirrors, 2embed, mp4hydra,
      //     primewire, hindiscraper) — these show in the picker for
      //     movies/shows but never return playable streams.
      //   - per-media failed sources.
      // For anime, SKIP the bundled @movie-web/providers entirely — they
      // are TMDB-based (vidsrc, superstream, etc.) and would only 404 /
      // return junk for MAL ids. Anime must come from the anime
      // servers above (Zoko).
           let baseSourceOrder = (isAnime ? [] : allSources)
        .filter(
          (source) => !BLOCKED_BUNDLED_SOURCE_IDS.has(source.id),
        )
        .map((source) => source.id);

      // Prepend ALL applicable custom server IDs — failed ones are
      // filtered out later (after the startFromSourceId slicing).
         baseSourceOrder = [...customIds, ...baseSourceOrder];

      // Apply custom source ordering if enabled
      if (enableSourceOrder && (preferredSourceOrder || []).length > 0) {
        const orderedSources: string[] = [];
        const remainingSources = [...baseSourceOrder];

        // Add sources in preferred order
        for (const sourceId of preferredSourceOrder) {
          const sourceIndex = remainingSources.indexOf(sourceId);
          if (sourceIndex !== -1) {
            orderedSources.push(sourceId);
            remainingSources.splice(sourceIndex, 1);
          }
        }

        // Add remaining sources
        baseSourceOrder = [...orderedSources, ...remainingSources];
      }

      // If we have a last successful source and the feature is enabled, prioritize it
      // BUT only if we're not resuming from a specific source (to preserve custom order)
      if (
        enableLastSuccessfulSource &&
        lastSuccessfulSource &&
        !startFromSourceId
      ) {
        const lastSourceIndex = baseSourceOrder.indexOf(lastSuccessfulSource);
        if (lastSourceIndex !== -1) {
          baseSourceOrder = [
            lastSuccessfulSource,
            ...baseSourceOrder.filter((id) => id !== lastSuccessfulSource),
          ];
        }
      }

           let filteredSourceOrder = baseSourceOrder;
      if (startFromSourceId) {
        const startIndex = filteredSourceOrder.indexOf(startFromSourceId);
        if (startIndex !== -1) {
          filteredSourceOrder = filteredSourceOrder.slice(startIndex + 1);
        } else {
          // At minimum never re-try the source we're resuming from.
          filteredSourceOrder = filteredSourceOrder.filter(
            (id) => id !== startFromSourceId,
          );
        }
      }

      // Failed-source filter LAST — after the slicing above — so already
      // failed servers are skipped and nothing before the resume point
      // is re-tried (kills the wrap-around loop).
      filteredSourceOrder = filteredSourceOrder.filter(
        (id) => !failedSources.includes(id),
      );

      // Collect all failed embed IDs across all sources for current media
      const allFailedEmbedIds = Object.values(failedEmbeds).flat();

      // Filter out failed embeds from the embed order
      const filteredEmbedOrder = enableEmbedOrder
        ? (preferredEmbedOrder || []).filter(
            (id) => !allFailedEmbedIds.includes(id),
          )
        : undefined;

      // ── Try custom servers FIRST ───────────────────────────
      // Pre-pass: iterate custom servers in their config order. Fire
      // a single synthetic init event with the FULL source list
      // (customs + regulars) up front, so the UI shows every source
      // from the start. Then iterate customs, firing start/update
      // events for each. On first success, return immediately.
      //
      // If all customs fail, fall through to runAll() — but pass a
      // no-op `init` so runAll doesn't WIPE the UI state we just
      // built. runAll's start/update events will then drive the
      // remaining regular sources normally.
      const customIdsToTry = filteredSourceOrder.filter((id) =>
        isCustomServerId(id),
      );
      if (customIdsToTry.length > 0) {
        // Fire synthetic init with ALL source IDs up front.
        initEvent({
          sourceIds: filteredSourceOrder,
        });
        for (const cid of customIdsToTry) {
          startEvent(cid);
          updateEvent({
            id: cid,
            status: "pending",
            percentage: 10,
          });
          try {
            const custom = await scrapeCustomServerByMedia(cid, {
              type: media.type,
              tmdbId: media.tmdbId,
              imdbId: media.imdbId,
              title: media.title,
              releaseYear: media.releaseYear,
              season: (media as any).season,
              episode: (media as any).episode,
              // Pass the MAL anime ID through so the Zoko anime server
              // can build URLs like /api/mal/{category}/{malId}/{episode}?worker=1.
              malId,
              // Sub/Dub category (only used by the Zoko anime server).
              miroruCategory,
            });
            updateEvent({
              id: cid,
              status: "success",
              percentage: 100,
            });
            const synthetic = customResultToRunOutput(custom);
            if (isExtensionActiveCached() && synthetic.stream) {
              try {
                await prepareStream(synthetic.stream);
              } catch (err) {
                console.warn("prepareStream failed for custom server", err);
              }
            }
            return getResult(synthetic);
          } catch (err) {
            console.warn(`Custom server ${cid} failed:`, err);
            updateEvent({
              id: cid,
              status: "failure",
              percentage: 100,
              error: err,
              reason: (err as any)?.message ?? "failed",
            });
            // continue to next custom server
          }
        }
        // All custom servers failed.
        // For anime, the custom servers ARE the only allowed sources —
        // the bundled @movie-web/providers are TMDB-based and would
        // just 404 / return junk for MAL ids. So short-circuit
        // here and return null (no stream found) instead of falling
        // through to runAll().
        //
        // Note: passing an empty sourceOrder to runAll() does NOT
        // skip the bundled providers — the library's reorderOnIdList
        // treats empty order as "use all sources sorted by rank".
        if (isAnime) {
          return getResult(null);
        }
        // For non-anime: fall through to bundled providers.
        // Strip custom IDs from the order so runAll() doesn't choke on them.
        filteredSourceOrder = filteredSourceOrder.filter(
          (id) => !isCustomServerId(id),
        );
      }
      // ── End custom servers pre-pass ────────────────────────

      // For anime with no custom servers configured (edge case),
      // there's nothing to try — bail out instead of running the
      // TMDB-based bundled providers.
      if (isAnime) {
        return getResult(null);
      }

      startScrape();
      const providers = getProviders();
      const output = await providers.runAll({
        media,
        sourceOrder: filteredSourceOrder,
        embedOrder: filteredEmbedOrder,
        events: {
          // No-op init: we already fired it ourselves above (or there
          // were no custom servers and runAll's init will fire
          // normally). Passing a no-op here means runAll won't WIPE
          // the source list we built during the pre-pass.
          init: customIdsToTry.length > 0 ? () => {} : initEvent,
          start: startEvent,
          update: updateEvent,
          discoverEmbeds: discoverEmbedsEvent,
        },
      });
      if (output && isExtensionActiveCached())
        await prepareStream(output.stream);
      return getResult(output);
    },
    [
      initEvent,
      startEvent,
      updateEvent,
      discoverEmbedsEvent,
      getResult,
      startScrape,
      preferredSourceOrder,
      enableSourceOrder,
      lastSuccessfulSource,
      enableLastSuccessfulSource,
      preferredEmbedOrder,
      enableEmbedOrder,
      miroruCategory,
    ],
  );

  const resumeScraping = useCallback(
    async (media: ScrapeMedia, startFromSourceId: string) => {
      return startScraping(media, startFromSourceId);
    },
    [startScraping],
  );

  return {
    startScraping,
    resumeScraping,
    sourceOrder,
    sources,
    currentSource,
  };
}

export function useListCenter(
  containerRef: RefObject<HTMLDivElement | null>,
  listRef: RefObject<HTMLDivElement | null>,
  sourceOrder: ScrapingItems[],
  currentSource: string | undefined,
) {
  const [renderedOnce, setRenderedOnce] = useState(false);

  const updatePosition = useCallback(() => {
    if (!containerRef.current) return;
    if (!listRef.current) return;

    const elements = [
      ...listRef.current.querySelectorAll("div[data-source-id]"),
    ] as HTMLDivElement[];

    const currentIndex = elements.findIndex(
      (e) => e.getAttribute("data-source-id") === currentSource,
    );

    const currentElement = elements[currentIndex];

    if (!currentElement) return;

    const containerWidth = containerRef.current.getBoundingClientRect().width;
    const listWidth = listRef.current.getBoundingClientRect().width;

    const containerHeight = containerRef.current.getBoundingClientRect().height;

    const listTop = listRef.current.getBoundingClientRect().top;

    const currentTop = currentElement.getBoundingClientRect().top;
    const currentHeight = currentElement.getBoundingClientRect().height;

    const topDifference = currentTop - listTop;

    const listNewLeft = containerWidth / 2 - listWidth / 2;
    const listNewTop = containerHeight / 2 - topDifference - currentHeight / 2;

    listRef.current.style.transform = `translateY(${listNewTop}px) translateX(${listNewLeft}px)`;
    setTimeout(() => {
      setRenderedOnce(true);
    }, 150);
  }, [currentSource, containerRef, listRef, setRenderedOnce]);

  const updatePositionRef = useRef(updatePosition);

  useEffect(() => {
    updatePosition();
    updatePositionRef.current = updatePosition;
  }, [updatePosition, sourceOrder]);

  useEffect(() => {
    function resize() {
      updatePositionRef.current();
    }
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
    };
  }, []);

  return renderedOnce;
}
