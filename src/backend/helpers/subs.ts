import { list } from "subsrt-ts";

import { proxiedFetch } from "@/backend/helpers/fetch";
import { convertSubtitlesToSrt } from "@/components/utils/captions";
import { CaptionListItem } from "@/stores/player/slices/source";
import { SimpleCache } from "@/utils/cache";
import { getProxyUrls } from "@/utils/proxyUrls";

import {
  isExtensionActiveCached,
  sendExtensionRequest,
} from "../extension/messaging";

export const subtitleTypeList = list().map((type) => `.${type}`);
const downloadCache = new SimpleCache<string, string>();
downloadCache.setCompare((a, b) => a === b);
const expirySeconds = 24 * 60 * 60;


/** Is at least one CORS proxy configured (env/config.js or auth store)? */
function hasCorsProxyConfigured(): boolean {
  try {
    return getProxyUrls().length > 0;
  } catch {
    return false;
  }
}

async function directFetchCaption(url: string): Promise<string> {
  const response = await fetch(url);
  const contentType = response.headers.get("content-type") || "";
  const charset = contentType.includes("charset=")
    ? contentType.split("charset=")[1].toLowerCase()
    : "utf-8";

  const buffer = await response.arrayBuffer();
  const decoder = new TextDecoder(charset);
  return decoder.decode(buffer);
}


/**
 * Always returns SRT
 */
export async function downloadCaption(
  caption: CaptionListItem,
): Promise<string> {
  const cached = downloadCache.get(caption.url);
  if (cached) return cached;

  if (!caption.url) {
    throw new Error("caption has no URL to download");
  }

  let data: string | undefined;
  if (caption.needsProxy && isExtensionActiveCached()) {
    const extensionResponse = await sendExtensionRequest({
      url: caption.url,
      method: "GET",
    });
    if (
      !extensionResponse?.success ||
      typeof extensionResponse.response.body !== "string"
    ) {
      throw new Error("failed to get caption data from extension");
    }

    data = extensionResponse.response.body;
  } else if (caption.needsProxy && hasCorsProxyConfigured()) {
    try {
      data = await proxiedFetch<string>(caption.url, {
        responseType: "text",
        headers: {
          "Accept-Charset": "utf-8",
        },
      });
    } catch (err) {
      console.warn("proxied caption fetch failed, retrying directly", err);
      data = await directFetchCaption(caption.url);
    }
  } else {
    // No proxy configured → fetch the VTT URL directly.
    // (Before: this called proxiedFetch() with no proxy → fetch(undefined)
    //  → the bogus /media/.../1/undefined request)
    data = await directFetchCaption(caption.url);
  }
  if (!data) throw new Error("failed to get caption data");

  const output = convertSubtitlesToSrt(data);
  downloadCache.set(caption.url, output, expirySeconds);
  return output;
}

/**
 * Downloads the WebVTT content. No different than a simple
 * get request with a cache.
 */
export async function downloadWebVTT(url: string): Promise<string> {
  const cached = downloadCache.get(url);
  if (cached) return cached;

  const data = await fetch(url).then((v) => v.text());
  return data;
}
