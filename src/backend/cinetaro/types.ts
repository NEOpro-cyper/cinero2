/**
 * Response types for the Cinetaro API servers.
 * These were derived from probing each live endpoint with sample IDs.
 */

// ───────────────────────────────────────────────────────────────
// Common shape used by several APIs
// ───────────────────────────────────────────────────────────────
export interface ApiCaption {
  url: string;
  label?: string;
  lang?: string;
  language?: string;
  type?: string; // "vtt" | "srt" ...
}

// ───────────────────────────────────────────────────────────────
// Armor — responseType: "opstream"
// GET /api/movie/{id} or /api/tv/{id}/{season}/{episode}
// ───────────────────────────────────────────────────────────────
export interface OpStreamResponse {
  success: boolean;
  type?: "movie" | "tv";
  tmdbId?: number | string;
  title?: string;
  server?: string;
  kind?: "hls" | "mp4" | string;
  streamUrl?: string;
  url?: string;
  captions?: ApiCaption[];
  error?: string;
}

// ───────────────────────────────────────────────────────────────
// Kuro (Bingr) — responseType: "bingr"
// GET /api/movie/{id} or /api/tv/{id}/{season}/{episode}
// Returns a list of servers, each with sources[] and subtitles[]
// ───────────────────────────────────────────────────────────────
export interface BingrSource {
  url: string;
  quality?: string;
  language?: string;
  type?: string; // "application/x-mpegURL" | "video/mp4"
  label?: string;
  name?: string;
  headers?: Record<string, string>;
}
export interface BingrServerEntry {
  no: number;
  id: string;
  name: string;
  cc: string;
  status: "ok" | "empty" | "error" | string;
  httpStatus?: number;
  scraperName?: string | null;
  sources: BingrSource[];
  subtitles: ApiCaption[];
  error?: string | null;
  cached?: boolean;
}
export interface BingrResponse {
  type: "movie" | "tv";
  tmdbId: number | string;
  title: string;
  year?: string;
  poster?: string;
  requestedServer?: number | null;
  servers: BingrServerEntry[];
  cache?: { hits: any[]; bypassed: boolean };
  error?: string;
}

// ───────────────────────────────────────────────────────────────
// Aether Tiki — responseType: "aether_tiki"
// GET /api/movie/{id}?server=4  or /api/show/{id}/{season}/{episode}?server=4
// Two known shapes:
//   Shape A (Tiki server): { data: { success, title, streams: [{name,url,type:"hls"}] } }
//   Shape B (other servers): { data: { stream: "https://..." } }
// ───────────────────────────────────────────────────────────────
export interface AetherStreamEntry {
  name?: string;
  url: string;
  type?: "hls" | "mp4" | string;
  quality?: string;
  language?: string;
}
export interface AetherTikiData {
  success?: boolean;
  title?: string;
  type?: "movie" | "tv";
  tmdb_id?: string | number;
  season?: number | string | null;
  episode?: number | string | null;
  streams?: AetherStreamEntry[];
  stream?: string; // Alternative single-URL shape
  url?: string;
  subtitles?: ApiCaption[];
}
export interface AetherTikiResponse {
  ok: boolean;
  server?: number;
  serverName?: string;
  source?: string;
  data?: AetherTikiData;
  errors?: string[];
}

// ───────────────────────────────────────────────────────────────
// Aether Meridian — responseType: "aether_meridian"
// GET /api/movie/{id}?server=2  or /api/show/{id}/{season}/{episode}?server=2
// Shape: { data: { title, url, subtitles: [{language,url,type:"vtt"}] } }
// ───────────────────────────────────────────────────────────────
export interface AetherMeridianData {
  title?: string;
  url: string;
  subtitles?: ApiCaption[];
  stream?: string;
  streams?: AetherStreamEntry[];
}
export interface AetherMeridianResponse {
  ok: boolean;
  server?: number;
  serverName?: string;
  source?: string;
  data?: AetherMeridianData;
  errors?: string[];
}

// ───────────────────────────────────────────────────────────────
// Vidnest — responseType: "vidnest"
// Currently returns 402 errors but typed for future compatibility
// ───────────────────────────────────────────────────────────────
export interface VidnestSource {
  url: string;
  quality?: string;
  type?: "hls" | "mp4" | string;
  label?: string;
  name?: string;
  language?: string;
}
export interface VidnestResponse {
  sources?: VidnestSource[];
  streams?: AetherStreamEntry[];
  url?: string;
  stream?: string;
  error?: string;
  status?: number;
}

// ───────────────────────────────────────────────────────────────
// Atlas (Vidrock) — responseType: "sources"
// GET /api/movie/{id}?server=atlas  or /api/tv/{id}/{season}/{episode}?server=atlas
// Shape: { sources: [{name,url,language,flag,type:"hls"|"mp4"}] }
// ───────────────────────────────────────────────────────────────
export interface AtlasSource {
  name?: string;
  url: string;
  language?: string;
  flag?: string;
  type?: "hls" | "mp4" | string;
  quality?: string;
}
export interface AtlasResponse {
  tmdbId?: string | number;
  id?: string | number;
  type?: "movie" | "tv";
  season?: number;
  episode?: number;
  totalServers?: number;
  availableSources?: number;
  sources: AtlasSource[];
  error?: string;
  available?: string[];
}

// ───────────────────────────────────────────────────────────────
// Generic stream-shaped response — responseType: "stream" | "stream_url" | "streamUrl"
// Shape: { stream: "https://..." }  OR  { streamUrl: "https://..." }  OR  { url: "https://..." }
// ───────────────────────────────────────────────────────────────
export interface GenericStreamResponse {
  stream?: string;
  streamUrl?: string;
  url?: string;
  sources?: AtlasSource[];
  qualities?: Record<string, string>;
  error?: string;
}

// ───────────────────────────────────────────────────────────────
// Qualities response — responseType: "qualities"
// Shape: { qualities: { "1080": "https://...", "720": "https://..." } }
// ───────────────────────────────────────────────────────────────
export interface QualitiesResponse {
  qualities?: Record<string, string>;
  sources?: AtlasSource[];
  stream?: string;
  error?: string;
}

// ───────────────────────────────────────────────────────────────
// Source-string response — responseType: "source_string"
// Shape: returns a plain string URL (or JSON-stringified URL)
// ───────────────────────────────────────────────────────────────
export type SourceStringResponse = string;
