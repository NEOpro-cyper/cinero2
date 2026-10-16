import fscreen from "fscreen";
import Hls, { Level } from "hls.js";

import {
  RULE_IDS,
  isExtensionActiveCached,
  setDomainRule,
} from "@/backend/extension/messaging";
import {
  DisplayError,
  DisplayInterface,
  DisplayInterfaceEvents,
} from "@/components/player/display/displayInterface";
import { handleBuffered } from "@/components/utils/handleBuffered";
import { getMediaErrorDetails } from "@/components/utils/mediaErrorDetails";
import {
  createM3U8ProxyUrl,
  createMP4ProxyUrl,
  isUrlAlreadyProxied,
} from "@/components/utils/proxy";
import { useLanguageStore } from "@/stores/language";
import {
  LoadableSource,
  SourceQuality,
  getPreferredQuality,
} from "@/stores/player/utils/qualities";
import { processCdnLink } from "@/utils/cdn";
import {
  canChangeVolume,
  canFullscreen,
  canFullscreenAnyElement,
  canPictureInPicture,
  canPlayHlsNatively,
  canWebkitFullscreen,
  canWebkitPictureInPicture,
} from "@/utils/detectFeatures";
import { makeEmitter } from "@/utils/events";

const levelConversionMap: Record<number, SourceQuality> = {
  360: "360",
  1080: "1080",
  720: "720",
  480: "480",
  2160: "4k",
};

// Define quality thresholds for mapping non-standard resolutions
const qualityThresholds = [
  { minHeight: 1800, quality: "4k" as SourceQuality },
  { minHeight: 800, quality: "1080" as SourceQuality },
  { minHeight: 600, quality: "720" as SourceQuality },
  { minHeight: 420, quality: "480" as SourceQuality },
  { minHeight: 0, quality: "360" as SourceQuality },
];

// ── Slow-server patience (see the watchdogs inside
// makeVideoElementDisplayInterface) ──────────────────────────────
// How long the player waits for a slow server before giving up and
// letting the app switch: the manifest must arrive within 75s, and
// the first playable fragment must buffer within 150s of starting.
// A server that produces data within that window is never abandoned.
const MANIFEST_LOAD_GRACE_MS = 75 * 1000;
const FIRST_PLAYBACK_GRACE_MS = 150 * 1000;

function hlsLevelToQuality(level?: Level): SourceQuality | null {
  if (!level?.height) return null;

  // First check for exact matches
  const exactMatch = levelConversionMap[level.height];
  if (exactMatch) return exactMatch;

  // For non-standard resolutions, map to closest standard quality
  for (const threshold of qualityThresholds) {
    if (level.height >= threshold.minHeight) {
      return threshold.quality;
    }
  }

  return "unknown"; // fallback to unknown quality
}

function hlsLevelsToQualities(levels: Level[]): SourceQuality[] {
  return levels
    .map((v) => hlsLevelToQuality(v))
    .filter((v): v is SourceQuality => !!v);
}

// Sort levels by quality (height) to ensure we can select the best one
function sortLevelsByQuality(levels: Level[]): Level[] {
  return [...levels].sort((a, b) => (b.height || 0) - (a.height || 0));
}

export function makeVideoElementDisplayInterface(): DisplayInterface {
  const { emit, on, off } = makeEmitter<DisplayInterfaceEvents>();
  let source: LoadableSource | null = null;
  let hls: Hls | null = null;
  let videoElement: HTMLVideoElement | null = null;
  let containerElement: HTMLElement | null = null;
  let isFullscreen = false;
  let isPictureInPicture = false;
  let isPausedBeforeSeeking = false;
  let isSeeking = false;
  let startAt = 0;
  let automaticQuality = false;
  let preferenceQuality: SourceQuality | null = null;
  let lastVolume = 1;
  let lastValidDuration = 0; // Store the last valid duration to prevent reset during source switches
  let lastValidTime = 0; // Store the last valid time to prevent reset during source switches
  let shouldAutoplayAfterLoad = false; // Flag to track if we should autoplay after loading completes
  let qualityChangeTimeout: NodeJS.Timeout | null = null; // Timeout for debouncing rapid quality changes

  // Startup watchdogs for the currently loading HLS source (see
  // MANIFEST_LOAD_GRACE_MS / FIRST_PLAYBACK_GRACE_MS above). Cleared
  // when the manifest loads, when the first fragment buffers, and on
  // every source unload.
  let manifestWatchdog: NodeJS.Timeout | null = null;
  let startupWatchdog: NodeJS.Timeout | null = null;

  function clearStartupWatchdogs() {
    if (manifestWatchdog) {
      clearTimeout(manifestWatchdog);
      manifestWatchdog = null;
    }
    if (startupWatchdog) {
      clearTimeout(startupWatchdog);
      startupWatchdog = null;
    }
  }

  const languagePromises = new Map<
    string,
    (value: void | PromiseLike<void>) => void
  >();

  function reportLevels() {
    if (!hls) return;
    const levels = hls.levels;
    const convertedLevels = levels
      .map((v) => hlsLevelToQuality(v))
      .filter((v): v is SourceQuality => !!v);
    emit("qualities", convertedLevels);
  }

  function reportAudioTracks() {
    if (!hls) return;
    const currentLanguage = useLanguageStore.getState().language;
    const audioTracks = hls.audioTracks;
    const languageTrack = audioTracks.find((v) => v.lang === currentLanguage);
    if (languageTrack) {
      hls.audioTrack = audioTracks.indexOf(languageTrack);
    }
    const currentTrack = audioTracks?.[hls.audioTrack ?? 0];
    if (!currentTrack) return;
    emit("changedaudiotrack", {
      id: currentTrack.id.toString(),
      label: currentTrack.name,
      language: currentTrack.lang ?? "unknown",
    });
    emit(
      "audiotracks",
      hls.audioTracks.map((v) => ({
        id: v.id.toString(),
        label: v.name,
        language: v.lang ?? "unknown",
      })),
    );
  }

  function setupQualityForHls() {
    if (videoElement && canPlayHlsNatively(videoElement)) {
      return; // nothing to change
    }

    if (!hls) return;
    if (!automaticQuality) {
      const sortedLevels = sortLevelsByQuality(hls.levels);
      const qualities = hlsLevelsToQualities(sortedLevels);
      const availableQuality = getPreferredQuality(qualities, {
        lastChosenQuality: preferenceQuality,
        automaticQuality,
      });
      if (availableQuality) {
        // Find the best level that matches our preferred quality
        const matchingLevels = hls.levels.filter(
          (level) => hlsLevelToQuality(level) === availableQuality,
        );
        if (matchingLevels.length > 0) {
          // Pick the highest resolution level for this quality
          const bestLevel = sortLevelsByQuality(matchingLevels)[0];
          const levelIndex = hls.levels.indexOf(bestLevel);
          if (levelIndex !== -1) {
            hls.currentLevel = levelIndex;
            hls.loadLevel = levelIndex;
          }
        }
      }
    } else {
      hls.currentLevel = -1;
      hls.loadLevel = -1;
    }
    // For manual quality selection, wait for LEVEL_SWITCHED to emit quality
    // to avoid showing intermediate states when HLS switches away from unplayable levels
    // For automatic quality, currentLevel is -1, so we wait for LEVEL_SWITCHED event
  }

  function setupSource(vid: HTMLVideoElement, src: LoadableSource) {
    hls = null;
    if (src.type === "hls") {
      if (canPlayHlsNatively(vid)) {
        vid.src = processCdnLink(src.url);
        vid.currentTime = startAt;
        return;
      }

      if (!Hls.isSupported())
        throw new Error("HLS not supported. Update your browser. 🤦‍♂️");
      if (!hls) {
        hls = new Hls({
          autoStartLoad: true,
          maxBufferLength: 120, // 120 seconds
          maxMaxBufferLength: 240,
          abrEwmaDefaultEstimate: 5 * 1000 * 1000, // 5 Mbps default bandwidth estimate for better ABR decisions
          fragLoadPolicy: {
            default: {
              maxLoadTimeMs: 30 * 1000, // allow it load extra long, fragments are slow if requested for the first time on an origin
              maxTimeToFirstByteMs: 30 * 1000,
              errorRetry: {
                maxNumRetry: 10,
                retryDelayMs: 1000,
                maxRetryDelayMs: 10000,
              },
              timeoutRetry: {
                maxNumRetry: 10,
                maxRetryDelayMs: 0,
                retryDelayMs: 0,
              },
            },
          },
          // Manifest + level playlists otherwise use hls.js defaults
          // (20s per attempt, 2 timeout retries) — far too impatient for
          // the worker-proxied CDNs this app plays, which can sit silent
          // for tens of seconds on a cold start. Give slow servers a
          // fair chance: up to 30s per attempt, first byte within 20s
          // (a stuck request restarts sooner), several timeout retries.
          manifestLoadPolicy: {
            default: {
              maxLoadTimeMs: 30 * 1000,
              maxTimeToFirstByteMs: 20 * 1000,
              errorRetry: {
                maxNumRetry: 3,
                retryDelayMs: 1000,
                maxRetryDelayMs: 4000,
              },
              timeoutRetry: {
                maxNumRetry: 4,
                retryDelayMs: 1000,
                maxRetryDelayMs: 4000,
              },
            },
          },
          // Covers level/media playlists (the master manifest has its
          // own policy above) — e.g. the index-v1-a1.m3u8 playlists.
          playlistLoadPolicy: {
            default: {
              maxLoadTimeMs: 30 * 1000,
              maxTimeToFirstByteMs: 20 * 1000,
              errorRetry: {
                maxNumRetry: 3,
                retryDelayMs: 1000,
                maxRetryDelayMs: 4000,
              },
              timeoutRetry: {
                maxNumRetry: 4,
                retryDelayMs: 1000,
                maxRetryDelayMs: 4000,
              },
            },
          },
          renderTextTracksNatively: false,
        });
        const exceptions = [
          "Failed to execute 'appendBuffer' on 'SourceBuffer': This SourceBuffer has been removed from the parent media source.",
        ];

        // ── Recovery state (per source load — the Hls instance is
        // recreated for every source) ─────────────────────────────
        // The player must NOT abandon a server that is still playable.
        // Before emitting an error (which switches to the next server)
        // we try to recover in place:
        //   • network errors  → hls.startLoad()
        //   • media errors    → hls.recoverMediaError() (+ codec swap)
        // Every successfully buffered fragment resets the budgets, so
        // a stream that recovered from one hiccup gets a fresh budget
        // for the next one.
        let manifestLoadedOnce = false;
        let networkRecoverAttempts = 0;
        let mediaRecoverAttempts = 0;
        let bufferedOnce = false;
        let startupFailed = false;
        const MAX_NETWORK_RECOVERY_ATTEMPTS = 2;
        const MAX_MEDIA_RECOVERY_ATTEMPTS = 2;

        // Emit a playback error at most ONCE per source. Without this
        // guard a single source could emit twice (e.g. hls fatal error
        // followed by a watchdog firing while the app is still
        // switching) and the second error would blame the NEXT server.
        const failSource = (err: DisplayError) => {
          if (startupFailed) return;
          startupFailed = true;
          clearStartupWatchdogs();
          emit("error", err);
        };

        // ── Slow-server watchdogs ────────────────────────────────
        // Switching servers just because one is slow to load is wrong —
        // these worker-proxied CDNs often stay silent for a long time.
        // hls.js keeps retrying internally; the watchdogs only give up
        // when the server has had a fair chance and produced NOTHING:
        //   • manifest still not loaded after MANIFEST_LOAD_GRACE_MS
        //   • not a single fragment buffered after FIRST_PLAYBACK_GRACE_MS
        clearStartupWatchdogs();
        manifestWatchdog = setTimeout(() => {
          manifestWatchdog = null;
          if (!manifestLoadedOnce) {
            console.warn(
              "HLS manifest never loaded — giving up on this server",
            );
            failSource({
              message:
                "Server took too long to load (manifest never responded)",
              errorName: "manifestLoadTimeOut",
              type: "hls",
              hls: {
                details: "manifestLoadTimeOut",
                fatal: true,
                type: Hls.ErrorTypes.NETWORK_ERROR,
              },
            });
          }
        }, MANIFEST_LOAD_GRACE_MS);
        startupWatchdog = setTimeout(() => {
          startupWatchdog = null;
          if (!bufferedOnce) {
            console.warn(
              "HLS produced no playable data — giving up on this server",
            );
            failSource({
              message:
                "Server took too long to start playing (no video data buffered)",
              errorName: "startupTimeOut",
              type: "hls",
              hls: {
                details: "fragLoadTimeOut",
                fatal: true,
                type: Hls.ErrorTypes.NETWORK_ERROR,
              },
            });
          }
        }, FIRST_PLAYBACK_GRACE_MS);

        hls?.on(Hls.Events.ERROR, (event, data) => {
          console.error("HLS error", data);

          // Extract detailed HLS error information
          const hlsErrorInfo = {
            details: data.details,
            fatal: data.fatal,
            level: data.level,
            levelDetails: (data as any).levelDetails
              ? {
                  url: (data as any).levelDetails.url,
                  width: (data as any).levelDetails.width,
                  height: (data as any).levelDetails.height,
                  bitrate: (data as any).levelDetails.bitrate,
                }
              : undefined,
            frag: data.frag
              ? {
                  url: data.frag.url,
                  baseurl: data.frag.baseurl,
                  duration: data.frag.duration,
                  start: data.frag.start,
                  sn: data.frag.sn,
                }
              : undefined,
            type: data.type,
            url: (data as any).url,
          };

          const isException = exceptions.includes(data.error?.message);
          if (isException) return;

          if (!data.fatal) {
            // Non-fatal errors: hls.js retries these internally via
            // its manifest/level/fragment load policies (and ABR can
            // simply move to another level). Only fast-fail when the
            // manifest fetch actually FAILED (HTTP error / unparseable
            // body) and never loaded — that URL is genuinely dead.
            // manifestLoadTimeOut is deliberately NOT in this list: a
            // timeout means the server is slow, not dead — hls.js keeps
            // retrying it and the startup watchdogs decide when patience
            // runs out. Fast-failing timeouts used to abandon
            // slow-but-playable servers after a single 20s attempt.
            const isManifestError = [
              "manifestLoadError",
              "manifestParsingError",
            ].includes(data.details);
            if (isManifestError && !manifestLoadedOnce) {
              failSource({
                message: `Failed to load HLS manifest: ${data.details}`,
                stackTrace: data.error?.stack || "",
                errorName: data.error?.name || data.details,
                type: "hls",
                hls: { ...hlsErrorInfo, fatal: true },
              });
            }
            return;
          }

          // Fatal error — attempt in-place recovery before giving up.
          if (
            data.type === Hls.ErrorTypes.NETWORK_ERROR &&
            networkRecoverAttempts < MAX_NETWORK_RECOVERY_ATTEMPTS
          ) {
            networkRecoverAttempts += 1;
            console.warn(
              `HLS network error (${data.details}) — attempting recovery ` +
                `(${networkRecoverAttempts}/${MAX_NETWORK_RECOVERY_ATTEMPTS})`,
            );
            hls?.startLoad();
            return;
          }
          if (
            data.type === Hls.ErrorTypes.MEDIA_ERROR &&
            mediaRecoverAttempts < MAX_MEDIA_RECOVERY_ATTEMPTS
          ) {
            mediaRecoverAttempts += 1;
            // Second media error: also swap the audio codec before
            // recovering (standard hls.js recovery ladder).
            if (mediaRecoverAttempts >= MAX_MEDIA_RECOVERY_ATTEMPTS)
              hls?.swapAudioCodec();
            console.warn(
              `HLS media error (${data.details}) — attempting recovery ` +
                `(${mediaRecoverAttempts}/${MAX_MEDIA_RECOVERY_ATTEMPTS})`,
            );
            hls?.recoverMediaError();
            return;
          }

          // Recovery exhausted (or unknown fatal type) — this source
          // is truly broken, let the app try the next server.
          failSource({
            message:
              data.error?.message || `HLS fatal: ${data.details}`,
            stackTrace: data.error?.stack,
            errorName: data.error?.name || data.details,
            type: "hls",
            hls: { ...hlsErrorInfo, fatal: true },
          });
        });
        // Successful buffering = playback is progressing again.
        // Prove the server works (stops the startup watchdogs) and
        // reset the recovery budgets so future hiccups get their own.
        hls?.on(Hls.Events.FRAG_BUFFERED, () => {
          bufferedOnce = true;
          clearStartupWatchdogs();
          networkRecoverAttempts = 0;
          mediaRecoverAttempts = 0;
        });
        hls.on(Hls.Events.MANIFEST_LOADED, () => {
          if (!hls) return;
          manifestLoadedOnce = true;
          // The server responded — stop the manifest watchdog.
          if (manifestWatchdog) {
            clearTimeout(manifestWatchdog);
            manifestWatchdog = null;
          }
          reportLevels();
          setupQualityForHls();
          reportAudioTracks();

          if (isExtensionActiveCached()) {
            hls.on(Hls.Events.LEVEL_LOADED, async (_, data) => {
              const chunkUrlsDomains = data.details.fragments.map(
                (v) => new URL(v.url).hostname,
              );
              const chunkUrls = [...new Set(chunkUrlsDomains)];

              await setDomainRule({
                ruleId: RULE_IDS.SET_DOMAINS_HLS,
                targetDomains: chunkUrls,
                requestHeaders: {
                  ...src.preferredHeaders,
                  ...src.headers,
                },
              });
            });
            hls.on(Hls.Events.AUDIO_TRACK_LOADED, async (_, data) => {
              const chunkUrlsDomains = data.details.fragments.map(
                (v) => new URL(v.url).hostname,
              );
              const chunkUrls = [...new Set(chunkUrlsDomains)];

              await setDomainRule({
                ruleId: RULE_IDS.SET_DOMAINS_HLS_AUDIO,
                targetDomains: chunkUrls,
                requestHeaders: {
                  ...src.preferredHeaders,
                  ...src.headers,
                },
              });
            });
          }
        });
        hls.on(Hls.Events.LEVEL_SWITCHED, () => {
          if (!hls) return;

          // Don't process level switched events during debounced quality changes
          if (qualityChangeTimeout) return;

          const currentLevel = hls.levels[hls.currentLevel];
          const currentQuality = hlsLevelToQuality(currentLevel);

          if (automaticQuality) {
            // Only emit quality changes when automatic quality is enabled
            emit("changedquality", currentQuality);
          } else {
            // For manual quality selection, emit the user's preferred quality
            // This ensures the UI shows the selected quality, not the actual playing quality
            emit("changedquality", preferenceQuality);
          }
        });
        hls.on(Hls.Events.SUBTITLE_TRACK_LOADED, () => {
          for (const [lang, resolve] of languagePromises) {
            const track = hls?.subtitleTracks.find((t) => t.lang === lang);
            if (track) {
              resolve();
              languagePromises.delete(lang);
              break;
            }
          }
        });
      }

      hls.attachMedia(vid);
      hls.loadSource(processCdnLink(src.url));
      vid.currentTime = startAt;
      return;
    }

    vid.src = processCdnLink(src.url);
    vid.currentTime = startAt;
  }

  function webkitPresentationModeChange() {
    if (!videoElement) return;
    const webkitPlayer = videoElement as any;
    const isInWebkitPip =
      webkitPlayer.webkitPresentationMode === "picture-in-picture";
    isPictureInPicture = isInWebkitPip;
    // Use native tracks in WebKit PiP mode for iOS compatibility
    emit("needstrack", isInWebkitPip);

    // On iOS, entering PiP may allow autoplay that was previously blocked
    if (isInWebkitPip && videoElement.paused && shouldAutoplayAfterLoad) {
      shouldAutoplayAfterLoad = false;
      videoElement.play().catch(() => {
        // If still blocked, emit pause to show play button
        emit("pause", undefined);
      });
    }
  }

  function setSource() {
    if (!videoElement || !source) return;
    setupSource(videoElement, source);
  }

  // ── Video element listeners ──────────────────────────────
  // Attached ONCE per video element (in processVideoElement), NOT in
  // setSource() — setSource() runs on every display.load() and used
  // to stack duplicate listeners on the same element, which made the
  // player emit multiple error/play events per occurrence.
  let attachedVideoElement: HTMLVideoElement | null = null;
  function attachVideoElementListeners() {
    const videoElement = attachedVideoElement;
    if (!videoElement) return;

    videoElement.addEventListener("play", () => {
      emit("play", undefined);
      emit("loading", false);
    });
    videoElement.addEventListener("error", () => {
      const err = videoElement?.error ?? null;
      // Ignore spurious errors: MEDIA_ERR_ABORTED (code 1) fires on
      // normal source swaps (removeAttribute + load()) and does NOT
      // mean the stream broke — emitting it here used to switch
      // servers while the stream was still playable.
      if (!err || err.code === 1) return;
      // Ignore errors on an element with no source loaded.
      if (!videoElement?.currentSrc) return;
      const errorDetails = getMediaErrorDetails(err);
      emit("error", {
        errorName: errorDetails.name,
        key: errorDetails.key,
        type: "htmlvideo",
      });
    });
    videoElement.addEventListener("playing", () => emit("play", undefined));
    videoElement.addEventListener("pause", () => emit("pause", undefined));
    videoElement.addEventListener("canplay", () => {
      // Check if video has enough buffered data to play smoothly (at least 5 seconds ahead)
      const hasEnoughBuffer = (() => {
        if (!videoElement) return false;
        const currentTime = videoElement.currentTime ?? 0;
        const buffered = videoElement.buffered;
        if (buffered.length === 0) return false;

        // Find the buffered range that contains current time
        for (let i = 0; i < buffered.length; i += 1) {
          if (
            currentTime >= buffered.start(i) &&
            currentTime <= buffered.end(i)
          ) {
            const bufferedAhead = buffered.end(i) - currentTime;
            return bufferedAhead >= 5; // At least 5 seconds buffered ahead
          }
        }
        return false;
      })();

      // Only set loading to false if we have enough buffer or if we're not at the start
      if (hasEnoughBuffer || (videoElement?.currentTime ?? 0) > 0) {
        emit("loading", false);
      }

      // Attempt autoplay if this was an autoplay transition (startAt = 0)
      if (shouldAutoplayAfterLoad && startAt === 0 && videoElement) {
        shouldAutoplayAfterLoad = false; // Reset the flag
        // Try to play - this will work on most platforms, but iOS may block it
        const playPromise = videoElement.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              // Autoplay succeeded
            })
            .catch((_error) => {
              // Play was blocked (likely iOS), emit that we're not playing
              // The AutoPlayStart component will show a play button
              emit("pause", undefined);
            });
        }
      }
    });
    videoElement.addEventListener("waiting", () => emit("loading", true));
    videoElement.addEventListener("volumechange", () =>
      emit(
        "volumechange",
        videoElement?.muted ? 0 : (videoElement?.volume ?? 0),
      ),
    );
    videoElement.addEventListener("timeupdate", () => {
      const currentTime = videoElement?.currentTime ?? 0;
      // Always emit time updates when seeking to prevent subtitle freezing
      // Also emit when progressing forward or when time changes significantly
      // This prevents time from resetting to 0 during source switches
      if (
        currentTime >= lastValidTime ||
        isSeeking ||
        Math.abs(currentTime - lastValidTime) > 0.1
      ) {
        lastValidTime = currentTime;
        emit("time", currentTime);
      }
    });
    videoElement.addEventListener("loadedmetadata", () => {
      if (
        source?.type === "hls" &&
        videoElement &&
        canPlayHlsNatively(videoElement)
      ) {
        emit("qualities", ["unknown"]);
        emit("changedquality", "unknown");
      }
      // Only emit duration if it's a valid value (> 0) to prevent progress reset during source switches
      const duration = videoElement?.duration ?? 0;
      if (duration > 0) {
        lastValidDuration = duration;
        emit("duration", duration);
      } else if (lastValidDuration > 0) {
        // Keep the last valid duration if the new one is invalid
        emit("duration", lastValidDuration);
      }
    });
    videoElement.addEventListener("progress", () => {
      if (videoElement) {
        const bufferedTime = handleBuffered(
          videoElement.currentTime,
          videoElement.buffered,
        );
        emit("buffered", bufferedTime);

        // Check if we now have enough buffer to stop loading
        const hasEnoughBuffer = (() => {
          const buffered = videoElement.buffered;
          if (buffered.length === 0) return false;

          const currentTime = videoElement.currentTime ?? 0;
          // Find the buffered range that contains current time
          for (let i = 0; i < buffered.length; i += 1) {
            if (
              currentTime >= buffered.start(i) &&
              currentTime <= buffered.end(i)
            ) {
              const bufferedAhead = buffered.end(i) - currentTime;
              return bufferedAhead >= 5; // At least 5 seconds buffered ahead
            }
          }
          return false;
        })();

        // If we're still loading but now have enough buffer, stop loading
        // This handles cases where canplay fired with insufficient buffer
        if (hasEnoughBuffer && videoElement.readyState >= 3) {
          emit("loading", false);
        }
      }
    });
    videoElement.addEventListener("webkitendfullscreen", () => {
      isFullscreen = false;
      emit("fullscreen", isFullscreen);
      if (!isFullscreen) emit("needstrack", false);
    });
    videoElement.addEventListener(
      "webkitplaybacktargetavailabilitychanged",
      (e: any) => {
        if (e.availability === "available") {
          emit("canairplay", true);
        }
      },
    );
    videoElement.addEventListener(
      "webkitpresentationmodechanged",
      webkitPresentationModeChange,
    );
    videoElement.addEventListener("ratechange", () => {
      if (videoElement) emit("playbackrate", videoElement.playbackRate);
    });

    videoElement.addEventListener("durationchange", () => {
      // Only emit duration if it's a valid value (> 0) to prevent progress reset during source switches
      const duration = videoElement?.duration ?? 0;
      if (duration > 0) {
        lastValidDuration = duration;
        emit("duration", duration);
      } else if (lastValidDuration > 0) {
        // Keep the last valid duration if the new one is invalid
        emit("duration", lastValidDuration);
      }
    });
  }

  function unloadSource() {
    // Clear any pending quality change timeout
    if (qualityChangeTimeout) {
      clearTimeout(qualityChangeTimeout);
      qualityChangeTimeout = null;
    }

    // Stop the slow-server watchdogs of the previous source
    clearStartupWatchdogs();

    if (videoElement) {
      videoElement.removeAttribute("src");
      videoElement.load();
    }
    if (hls) {
      hls.destroy();
      hls = null;
    }
    // Reset the last valid duration and time when unloading source
    lastValidDuration = 0;
    lastValidTime = 0;
  }

  function destroyVideoElement() {
    unloadSource();
    if (videoElement) {
      videoElement = null;
    }
    // Clear any remaining timeout
    if (qualityChangeTimeout) {
      clearTimeout(qualityChangeTimeout);
      qualityChangeTimeout = null;
    }
  }

  function fullscreenChange() {
    isFullscreen =
      !!document.fullscreenElement || // other browsers
      !!(document as any).webkitFullscreenElement; // safari
    emit("fullscreen", isFullscreen);
    if (!isFullscreen) emit("needstrack", false);

    // On iOS, entering fullscreen may allow autoplay that was previously blocked
    if (
      isFullscreen &&
      videoElement &&
      videoElement.paused &&
      shouldAutoplayAfterLoad
    ) {
      shouldAutoplayAfterLoad = false;
      videoElement.play().catch(() => {
        // If still blocked, emit pause to show play button
        emit("pause", undefined);
      });
    }
  }
  fscreen.addEventListener("fullscreenchange", fullscreenChange);

  function pictureInPictureChange() {
    isPictureInPicture = !!document.pictureInPictureElement;
    // Use native tracks in PiP mode for better compatibility with iOS and other platforms
    emit("needstrack", isPictureInPicture);

    // Entering PiP may allow autoplay that was previously blocked
    if (
      isPictureInPicture &&
      videoElement &&
      videoElement.paused &&
      shouldAutoplayAfterLoad
    ) {
      shouldAutoplayAfterLoad = false;
      videoElement.play().catch(() => {
        // If still blocked, emit pause to show play button
        emit("pause", undefined);
      });
    }
  }

  document.addEventListener("enterpictureinpicture", pictureInPictureChange);
  document.addEventListener("leavepictureinpicture", pictureInPictureChange);

  return {
    on,
    off,
    getType() {
      return "web";
    },
    destroy: () => {
      destroyVideoElement();
      fscreen.removeEventListener("fullscreenchange", fullscreenChange);
      document.removeEventListener(
        "enterpictureinpicture",
        pictureInPictureChange,
      );
      document.removeEventListener(
        "leavepictureinpicture",
        pictureInPictureChange,
      );
    },
    load(ops) {
      // Always tear down the previous source before loading a new one.
      // Without this the old Hls instance is orphaned while still
      // retrying in the background, and its late errors get blamed on
      // the NEW source — abandoning healthy servers (phantom failures,
      // e.g. "switched even though the stream was playable").
      unloadSource();
      automaticQuality = ops.automaticQuality;
      preferenceQuality = ops.preferredQuality;
      source = ops.source;
      emit("loading", true);
      startAt = ops.startAt;
      // Set autoplay flag if starting from beginning (indicates autoplay transition)
      shouldAutoplayAfterLoad = ops.startAt === 0;
      setSource();
    },
    changeQuality(newAutomaticQuality, newPreferredQuality) {
      if (source?.type !== "hls") return;

      // Clear any pending quality change to prevent race conditions
      if (qualityChangeTimeout) {
        clearTimeout(qualityChangeTimeout);
        qualityChangeTimeout = null;
      }

      automaticQuality = newAutomaticQuality;
      preferenceQuality = newPreferredQuality;

      // Debounce quality changes to prevent rapid switching issues
      qualityChangeTimeout = setTimeout(() => {
        setupQualityForHls();
        qualityChangeTimeout = null;
      }, 100); // 100ms debounce delay
    },

    processVideoElement(video) {
      destroyVideoElement();
      videoElement = video;
      // Only attach listeners once per element — re-registering on the
      // same element stacks duplicate event listeners.
      if (video !== attachedVideoElement) {
        attachedVideoElement = video;
        attachVideoElementListeners();
      }
      setSource();
      this.setVolume(lastVolume);
    },
    processContainerElement(container) {
      containerElement = container;
    },
    setMeta() {},
    setCaption() {},

    pause() {
      videoElement?.pause();
    },
    play() {
      videoElement?.play();
    },
    setSeeking(active) {
      if (active === isSeeking) return;
      isSeeking = active;

      // if it was playing when starting to seek, play again
      if (!active) {
        if (!isPausedBeforeSeeking) this.play();
        return;
      }

      isPausedBeforeSeeking = videoElement?.paused ?? true;
      this.pause();
    },
    setTime(t) {
      if (!videoElement) return;
      // clamp time between 0 and max duration
      let time = Math.min(t, videoElement.duration);
      time = Math.max(0, time);

      if (Number.isNaN(time)) return;
      emit("time", time);
      videoElement.currentTime = time;
    },
    async setVolume(v) {
      // clamp time between 0 and 1
      let volume = Math.min(v, 1);
      volume = Math.max(0, volume);

      // actually set
      lastVolume = v;
      if (!videoElement) return;
      videoElement.muted = volume === 0; // Muted attribute is always supported

      // update state
      const isChangeable = await canChangeVolume();
      if (isChangeable) {
        videoElement.volume = volume;
      } else {
        // For browsers where it can't be changed
        emit("volumechange", volume === 0 ? 0 : 1);
      }
    },
    toggleFullscreen() {
      if (isFullscreen) {
        isFullscreen = false;
        emit("fullscreen", isFullscreen);
        emit("needstrack", false);
        if (!fscreen.fullscreenElement) return;
        fscreen.exitFullscreen();
        return;
      }

      // enter fullscreen
      isFullscreen = true;
      emit("fullscreen", isFullscreen);
      if (!canFullscreen() || fscreen.fullscreenElement) return;
      if (canFullscreenAnyElement()) {
        if (containerElement) fscreen.requestFullscreen(containerElement);
        return;
      }
      if (canWebkitFullscreen()) {
        if (videoElement) {
          emit("needstrack", true);
          (videoElement as any).webkitEnterFullscreen();
        }
      }
    },
    togglePictureInPicture() {
      if (!videoElement) return;
      if (canWebkitPictureInPicture()) {
        const webkitPlayer = videoElement as any;
        webkitPlayer.webkitSetPresentationMode(
          webkitPlayer.webkitPresentationMode === "picture-in-picture"
            ? "inline"
            : "picture-in-picture",
        );
      }
      if (canPictureInPicture()) {
        if (videoElement !== document.pictureInPictureElement) {
          videoElement.requestPictureInPicture();
        } else {
          document.exitPictureInPicture();
        }
      }
    },
    startAirplay() {
      const videoPlayer = videoElement as any;
      if (!videoPlayer || !videoPlayer.webkitShowPlaybackTargetPicker) return;

      if (!source) {
        // No source loaded, just trigger Airplay
        videoPlayer.webkitShowPlaybackTargetPicker();
        return;
      }

      // Store the original URL to restore later
      const originalUrl =
        source?.type === "hls" ? hls?.url || source.url : videoPlayer.src;

      let proxiedUrl: string | null = null;

      if (source?.type === "hls") {
        // Only proxy HLS streams if they need it:
        // 1. Not already proxied AND
        // 2. Has headers (either preferredHeaders or headers)
        const allHeaders = {
          ...source.preferredHeaders,
          ...source.headers,
        };
        const hasHeaders = Object.keys(allHeaders).length > 0;

        // Don't create proxy URL if it's already using the proxy
        if (!isUrlAlreadyProxied(source.url) && hasHeaders) {
          proxiedUrl = createM3U8ProxyUrl(source.url, allHeaders);
        } else {
          proxiedUrl = source.url; // Already proxied or no headers needed
        }
      } else if (source?.type === "mp4") {
        const allHeaders = {
          ...source.preferredHeaders,
          ...source.headers,
        };
        const hasHeaders = Object.keys(allHeaders).length > 0;
        if (!isUrlAlreadyProxied(source.url) && hasHeaders) {
          // Use MP4 proxy for streams with headers
          proxiedUrl = createMP4ProxyUrl(source.url, allHeaders);
        } else {
          proxiedUrl = source.url;
        }
      }

      // Function to restore original URL
      const restoreOriginalUrl = () => {
        if (source?.type === "hls") {
          if (hls && originalUrl) {
            hls.loadSource(originalUrl);
          }
        } else if (originalUrl) {
          videoPlayer.src = originalUrl;
        }
      };

      // Function to check airplay state and restore if needed
      const checkAirplayState = () => {
        const isWireless = videoPlayer.webkitCurrentPlaybackTargetIsWireless;
        if (!isWireless) {
          // Airplay didn't start or ended, restore original URL
          restoreOriginalUrl();
        }
      };

      if (proxiedUrl && proxiedUrl !== originalUrl) {
        // Set the proxied URL for Airplay
        if (source?.type === "hls") {
          if (hls) {
            hls.loadSource(proxiedUrl);
          } else {
            videoPlayer.src = proxiedUrl;
          }
        } else {
          videoPlayer.src = proxiedUrl;
        }

        // Small delay to ensure the URL is set before triggering Airplay
        setTimeout(() => {
          videoPlayer.webkitShowPlaybackTargetPicker();

          // Check airplay state after user interaction
          // Give user time to select device, then check if airplay started
          setTimeout(() => {
            checkAirplayState();
          }, 2000);

          // Set up periodic check for airplay state changes
          const airplayCheckInterval = setInterval(() => {
            const isWireless =
              videoPlayer.webkitCurrentPlaybackTargetIsWireless;
            if (!isWireless) {
              // Airplay ended, restore original URL
              restoreOriginalUrl();
              clearInterval(airplayCheckInterval);
            }
          }, 1000);

          // Clear interval after 5 minutes as safety measure
          setTimeout(() => clearInterval(airplayCheckInterval), 300000);
        }, 100);
      } else {
        // No proxying needed, just trigger Airplay
        videoPlayer.webkitShowPlaybackTargetPicker();
      }
    },
    setPlaybackRate(rate) {
      if (videoElement) videoElement.playbackRate = rate;
    },
    getCaptionList() {
      return (
        hls?.subtitleTracks.map((track) => {
          return {
            id: track.id.toString(),
            language: track.lang ?? "unknown",
            url: track.url,
            type: "vtt", // HLS captions are typically VTT format
            needsProxy: false,
            hls: true,
          };
        }) ?? []
      );
    },
    getSubtitleTracks() {
      return hls?.subtitleTracks ?? [];
    },
    async setSubtitlePreference(lang) {
      // default subtitles are already loaded by hls.js
      const track = hls?.subtitleTracks.find((t) => t.lang === lang);
      if (track?.details !== undefined) return Promise.resolve();

      // need to wait a moment before hls loads the subtitles
      const promise = new Promise<void>((resolve, reject) => {
        languagePromises.set(lang, resolve);

        // reject after some time, if hls.js fails to load the subtitles
        // for any reason
        setTimeout(() => {
          reject();
          languagePromises.delete(lang);
        }, 5000);
      });
      hls?.setSubtitleOption({ lang });
      return promise;
    },
    changeAudioTrack(track) {
      if (!hls) return;
      const audioTrack = hls?.audioTracks.find(
        (t) => t.id.toString() === track.id,
      );
      if (!audioTrack) return;
      hls.audioTrack = hls.audioTracks.indexOf(audioTrack);
      emit("changedaudiotrack", {
        id: audioTrack.id.toString(),
        label: audioTrack.name,
        language: audioTrack.lang ?? "unknown",
      });
    },
  };
}
