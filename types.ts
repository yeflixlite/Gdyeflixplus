/**
 * ============================================================
 *  types.ts
 *  Interfaces y tipos compartidos en todo el proyecto
 * ============================================================
 */

// ── Tipos de video ────────────────────────────────────────────
export type VideoType = 'm3u8' | 'mp4' | 'dash';

// ── Info de DRM (para canales como Telemundo) ─────────────────
export interface DrmInfo {
  keyId: string;
  key:   string;
}

// ── Resultado de extracción de un servicio ─────────────────────
export interface ExtractResult {
  videoUrl:   string;
  type:       VideoType;
  referer:    string;
  /** Nivel de calidad para envolver en master sintético (ej. '720p') */
  wrapLevel?: string;
  /** Información DRM para streams protegidos */
  drm?:       DrmInfo;
  /** Método usado para extraer (http | puppeteer | http_mirror) */
  method?:    string;
}

// ── Interfaz común de todos los servicios ────────────────────
export interface IVideoService {
  extract(url?: string): Promise<ExtractResult>;
}

// ── Entrada de caché en memoria ──────────────────────────────
export interface CacheEntry<T> {
  body:      T;
  ts:        number;
}

// ── Entrada de caché para servicios de extracción ────────────
export interface ExtractionCacheEntry {
  result:    ExtractResult;
  timestamp: number;
}

// ── Respuesta del endpoint /play ─────────────────────────────
export interface PlayResponse {
  videoUrl:  string;
  proxyUrl:  string;
  type:      VideoType;
  provider:  string;
  method:    string | null;
}

// ── Respuesta del endpoint /extract ─────────────────────────
export interface ExtractResponse {
  ok:        true;
  videoUrl:  string;
  proxyUrl:  string;
  type:      VideoType;
  provider:  string;
  isHlsTxt:  boolean;
  method:    string | null;
}

// ── Respuesta de error genérica ──────────────────────────────
export interface ErrorResponse {
  ok:    false;
  error: string;
}

// ── Respuesta del endpoint /api/tv/extract ───────────────────
export interface TvExtractResponse {
  videoUrl:  string;
  proxyUrl:  string;
  type:      VideoType;
  provider:  string;
  drm:       DrmInfo | null;
}

// ── Opciones para fetchWithRetry ─────────────────────────────
export interface FetchOptions {
  headers?:      Record<string, string>;
  referer?:      string;
  origin?:       string;
  responseType?: 'text' | 'json' | 'stream' | 'arraybuffer';
  timeout?:      number;
  httpsAgent?:   import('https').Agent;
  httpAgent?:    import('http').Agent;
}
