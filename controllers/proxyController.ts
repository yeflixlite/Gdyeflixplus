/**
 * ============================================================
 *  controllers/proxyController.ts
 *  Sirve el contenido del video evitando CORS.
 *  Optimizado para Filemoon (persistencia de tokens de sesión).
 * ============================================================
 */

'use strict';

import { Request, Response } from 'express';
import axios, { AxiosResponse } from 'axios';
import zlib from 'zlib';
import urlLib from 'url';
import http from 'http';
import https from 'https';

const { getMediaHeaders } = require('../utils/browserHeaders');
const { detectProvider } = require('../utils/urlDetector');

/* ── CONFIGURACIÓN DE AHORRO DE BANDA ───────────────────────── */
// Si es 'false', los segmentos (.ts) se cargan directo del CDN original.
// Esto ahorra el 95% del ancho de banda del servidor.
const PROXY_SEGMENTS = process.env.PROXY_SEGMENTS === 'true';
const IS_PROD        = process.env.NODE_ENV === 'production';

// Lista de dominios que permiten carga directa (CORS abierto sin IP-binding)
// NOTA: Si un dominio bloquea por CORS en el navegador, NO debe estar aquí.
// VOE (*.cloudwindow-route.com) fue RETIRADO (16/09/2026): el CDN ya no envía
// Access-Control-Allow-Origin desde el navegador y los tokens quedan ligados a
// la IP del servidor → 403/CORS en directo. El tráfico VOE DEBE pasar por el
// proxy (hot-swap incluido).
const DIRECT_DOMAINS: string[] = [
    // Filemoon CDN: *.r66nv9ed.com responde ACAO: * en master/variante/segmentos
    // sin cifrado EXT-X-KEY → se puede saltar el proxy.
    'r66nv9ed.com',
    // VidHide MIRRORS: cuando el m3u8 usa /stream/ del mirror, los segmentos
    // los sirve el mismo mirror con CORS abierto (no el CDN acek/dramiyos)
    'minochinos.com', 'callistanise.com', 'vsharea.com', 'vidhidepro.com', 'vidhide.com',
    // Otros CDNs sin restricciones conocidas
    'doodstream.com', 'dood.re',
    'filemoon.sx', 'googleusercontent.com', 'cloudfront.net',
];

// Agentes con Keep-Alive para rendimiento
const httpAgent  = new http.Agent({ keepAlive: true, maxSockets: 50 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

const AD_BLOCKLIST: string[] = [
    'tiktokcdn.com', 'doubleclick.net', 'adnxs.com', 'advertising.com',
    'quantserve.com', 'scorecardresearch.com', 'clisky.xyz', 'trbt.it'
];

// ── Cache en memoria para M3U8 maestros ──────────────────────
// TTL de 8 segundos: el suficiente para absorber picos de usuarios,
// sin servir listas tan viejas que tengan segmentos expirados.
const m3u8Cache = new Map<string, { body: string; ts: number }>();
const M3U8_CACHE_TTL = 8_000; // 8 segundos

function getCached(key: string): string | null {
    const entry = m3u8Cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > M3U8_CACHE_TTL) {
        m3u8Cache.delete(key);
        return null;
    }
    return entry.body;
}

function setCache(key: string, body: string): void {
    // Limitar el tamaño del caché para no agotar la RAM de Vercel
    if (m3u8Cache.size > 100) {
        const firstKey = m3u8Cache.keys().next().value as string;
        m3u8Cache.delete(firstKey);
    }
    m3u8Cache.set(key, { body, ts: Date.now() });
}

/**
 * Resuelve URLs relativas conservando los Query Params de la base.
 * CRÍTICO para Filemoon y similares donde los segmentos dependen del token de la playlist.
 */
function resolveUrl(target: string, base: string): string {
  if (target.startsWith('http')) return target;

  const baseUrl = new URL(base);
  let resolved: URL;

  if (target.startsWith('//')) {
    resolved = new URL(`${baseUrl.protocol}${target}`);
  } else if (target.startsWith('/')) {
    resolved = new URL(`${baseUrl.origin}${target}`);
  } else {
    const dirPath = baseUrl.pathname.substring(0, baseUrl.pathname.lastIndexOf('/') + 1);
    resolved = new URL(`${baseUrl.origin}${dirPath}${target}`);
  }

  // SI LA BASE TIENE PARÁMETROS (?, t=, s=, e=) Y EL TARGET NO, SE LOS PASAMOS
  if (baseUrl.search) {
    const baseParams   = baseUrl.searchParams;
    const targetParams = resolved.searchParams;

    // Parámetros críticos de StreamWish/Filemoon
    ['t', 's', 'e', 'token'].forEach(p => {
      if (baseParams.has(p) && !targetParams.has(p)) {
        targetParams.set(p, baseParams.get(p) as string);
      }
    });
  }

  return resolved.toString();
}

function rewriteM3u8(content: string, originalUrl: string, proxyBase: string, referer: string): string {
  const encodedReferer = encodeURIComponent(referer || '');

  // 1. Líneas de segmentos
  let rewritten = content.replace(
    /^(?!#)(.+)$/gm,
    (line: string) => {
      line = line.trim();
      if (!line) return line;
      const abs = resolveUrl(line, originalUrl);

      // Bloqueo de anuncios
      const isAd = AD_BLOCKLIST.some(domain => abs.includes(domain));
      if (isAd) return abs;

      // LÓGICA DE AHORRO: ¿Debemos saltarnos el proxy para este segmento?
      const isSegment = abs.includes('.ts') || abs.includes('.m4s') || abs.includes('.mp4') || abs.includes('/seg-') || abs.includes('.woff2');
      const canBeDirect = DIRECT_DOMAINS.some(d => abs.includes(d));

      if (isSegment && !PROXY_SEGMENTS && canBeDirect) {
          // Devolvemos la URL directa. Ahorramos 100% de banda en este fragmento.
          return abs;
      }

      return `${proxyBase}?url=${encodeURIComponent(abs)}&referer=${encodedReferer}`;
    }
  );

  // 2. Atributos URI (Audio, Key, etc.)
  rewritten = rewritten.replace(
    /URI=["']([^"']+)["']/g,
    (_match: string, captured: string) => {
      const abs = resolveUrl(captured, originalUrl);
      return `URI="${proxyBase}?url=${encodeURIComponent(abs)}&referer=${encodedReferer}&forceM3u8=1"`;
    }
  );

  // 3. Arreglo para "Nivel 0" (VOE / Filemoon)
  // Aseguramos que la línea tenga RESOLUTION y NAME válidos.
  // Algunos servidores envían RESOLUTION=0x0 que confunde al reproductor.
  rewritten = rewritten.replace(
    /#EXT-X-STREAM-INF:([^\r\n]+)/g,
    (_match: string, attributes: string) => {
      let newAttributes = attributes;

      let res  = '1280x720';
      let name = '"720p"';
      const resMatch = attributes.match(/RESOLUTION=(\d+)x(\d+)/i);
      if (resMatch) {
        const height = parseInt(resMatch[2]);
        res = `${resMatch[1]}x${resMatch[2]}`;
        if      (height >= 2160) name = '"4K"';
        else if (height >= 1080) name = '"1080p"';
        else if (height >= 720)  name = '"720p"';
        else if (height >= 480)  name = '"480p"';
        else if (height >= 360)  name = '"360p"';
        else                     name = `"${height}p"`;
      } else {
        if      (attributes.includes('1080p') || attributes.includes('1920x1080')) { res = '1920x1080'; name = '"1080p"'; }
        else if (attributes.includes('480p')  || attributes.includes('854x480'))   { res = '854x480';   name = '"480p"'; }
        else if (attributes.includes('360p')  || attributes.includes('640x360'))   { res = '640x360';   name = '"360p"'; }
        else if (attributes.includes('4K')    || attributes.includes('2160p'))     { res = '3840x2160'; name = '"4K"'; }
      }

      newAttributes = newAttributes.replace(/,?RESOLUTION=[^\s,]+/gi, '');
      newAttributes = newAttributes.replace(/,?NAME=[^\s,]+/gi, '');
      newAttributes += `,RESOLUTION=${res},NAME=${name}`;

      return `#EXT-X-STREAM-INF:${newAttributes}`;
    }
  );

  return rewritten;
}

// ── Fetch con reintento ──────────────────────────────────────
async function fetchUpstream(
  url: string,
  headers: Record<string, string>,
  timeout: number,
  req?: Request
): Promise<AxiosResponse> {
    const controller = new AbortController();

    if (req) {
        req.on('close', () => {
            controller.abort();
        });
    }

    const config = {
        headers,
        responseType: 'stream' as const,
        httpAgent,
        httpsAgent,
        maxRedirects: 10,
        timeout,
        signal: controller.signal,
        validateStatus: (status: number) => status < 400 || status === 403,
    };

    try {
        return await axios.get(url, config);
    } catch (err) {
        if (axios.isCancel(err)) throw err;
        // Un solo reintento automático antes de rendirse
        if (!IS_PROD) console.log(`[Proxy] ⚠️ Reintentando: ${url.substring(0, 60)}...`);
        return await axios.get(url, config);
    }
}

async function proxyHandler(req: Request, res: Response): Promise<any> {
  try {
    const {
      url,
      referer = '',
      forceM3u8 = '0',
      wrapM3u8 = '',
      wrap: wrapAlias = '',
      type = '',
      embed_url = '',
    } = req.query as Record<string, string>;

    if (!url) return res.status(400).end();

    let decodedUrl       = decodeURIComponent(url);
    const decodedReferer = referer ? decodeURIComponent(referer) : '';

    let origin = '';
    try { origin = new URL(decodedUrl).origin; } catch { /* url relativa */ }

    const isAd = AD_BLOCKLIST.some(domain => decodedUrl.includes(domain));
    if (isAd) return res.status(404).end();

    const isDash = type === 'dash' || decodedUrl.includes('.mpd');

    const isM3u8Request = decodedUrl.includes('.m3u') ||
                          forceM3u8 === '1' ||
                          isDash;

    // Log solo en desarrollo
    if (!IS_PROD && isM3u8Request) {
       console.log(`[Proxy] 📄 Manifest: ${decodedUrl.substring(0, 70)}...`);
    }

    const wrapLevel = wrapM3u8 || wrapAlias;

    // Servir desde caché si existe
    if (isM3u8Request) {
        const cached = getCached(decodedUrl + (wrapLevel ? '?wrap=' + wrapLevel : ''));
        if (cached) {
            res.status(200);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', isDash ? 'application/dash+xml' : 'application/vnd.apple.mpegurl');
            res.setHeader('X-Cache', 'HIT');
            return sendCompressed(req, res, cached);
        }
    }

    // LOGICA DE REFERER
    let targetOrigin = '';
    try { targetOrigin = new URL(decodedUrl).origin; } catch { /* url relativa */ }
    const effectiveReferer = decodedReferer || targetOrigin;

    const headers: Record<string, string> = getMediaHeaders(effectiveReferer, targetOrigin);
    if (req.headers.range) {
      headers['Range'] = req.headers.range as string;
    }

    // StreamWish: reenviar la IP real para evitar su rate-limit de IP dual.
    // En VOE estropea la comprobación de IP y causa 403.
    const isStreamwish = decodedUrl.includes('streamwish') || decodedUrl.includes('premilkyway') || decodedUrl.includes('goldenfieldcreativeworks');
    if (isStreamwish) {
      if (req.headers['x-forwarded-for']) headers['X-Forwarded-For'] = req.headers['x-forwarded-for'] as string;
      if (req.headers['x-real-ip'])       headers['X-Real-IP']       = req.headers['x-real-ip'] as string;
    }

    // Timeout diferenciado
    // M3U8/playlists son archivos pequeños → fallar rápido (8s)
    // Segmentos de video pueden ser pesados → más tiempo (15s)
    const isSegment = decodedUrl.includes('.ts') ||
                      decodedUrl.includes('.m4s') ||
                      decodedUrl.includes('.mp4');
    const timeout = isM3u8Request ? 8_000 : (isSegment ? 15_000 : 20_000);

    let upstream = await fetchUpstream(decodedUrl, headers, timeout, req);

    // ── RE-EXTRACCIÓN PARA VOE (ERROR 403 IP-BINDING M3U8 y TS) ──
    if (upstream.status === 403) {
        if (detectProvider(effectiveReferer) === 'voe' || detectProvider(decodedUrl) === 'voe') {
            console.log(`[Proxy] ⚠️ Error 403 en VOE para ${isM3u8Request ? 'M3U8' : 'Fragmento TS'}. Iniciando re-extracción en caliente (Hot-Swap)...`);
            try {
                const voeService = require('../services/voe');

                // Extraer el ID real del video de la URL del CDN si es posible
                let extractTarget = effectiveReferer || (embed_url ? decodeURIComponent(embed_url) : '');
                const videoIdMatch = decodedUrl.match(/\/([a-zA-Z0-9]+)_[a-zA-Z0-9,]*\.urlset\//);
                if (videoIdMatch && videoIdMatch[1]) {
                    extractTarget = 'https://voe.sx/e/' + videoIdMatch[1];
                    console.log(`[Proxy] 🔍 ID de VOE detectado en la URL: ${videoIdMatch[1]}`);
                }

                const result = await voeService.extract(extractTarget);

                if (result && result.videoUrl) {
                    if (isM3u8Request) {
                        // Es un M3U8 maestro, usamos la nueva URL entera
                        if (result.videoUrl !== decodedUrl) {
                            console.log(`[Proxy] ✅ Re-extracción M3U8 exitosa. Reintentando...`);
                            decodedUrl = result.videoUrl;
                            let newOrigin = '';
                            try { newOrigin = new URL(decodedUrl).origin; } catch { /* relativa */ }
                            const newHeaders = getMediaHeaders(effectiveReferer, newOrigin);
                            upstream = await fetchUpstream(decodedUrl, newHeaders, timeout, req);
                        }
                    } else if (isSegment) {
                        // Es un fragmento TS. Hacemos HOT-SWAPPING de los tokens del query string
                        const newMasterUrl  = new URL(result.videoUrl);
                        const oldSegmentUrl = new URL(decodedUrl);

                        // Mantenemos la ruta del segmento viejo pero le inyectamos los tokens criptográficos nuevos
                        oldSegmentUrl.search = newMasterUrl.search;
                        decodedUrl = oldSegmentUrl.toString();

                        console.log(`[Proxy] ✅ Hot-Swap de TS exitoso. Reintentando fragmento con nueva IP local...`);
                        let newOrigin = '';
                        try { newOrigin = new URL(decodedUrl).origin; } catch { /* relativa */ }
                        const newHeaders = getMediaHeaders(effectiveReferer, newOrigin);
                        upstream = await fetchUpstream(decodedUrl, newHeaders, timeout, req);
                    }
                }
            } catch (retryErr) {
                console.error(`[Proxy] ❌ Falló el Hot-Swap de VOE:`, (retryErr as Error).message);
            }
        }
    }

    const isM3u8 = isM3u8Request ||
                   (upstream.headers['content-type'] || '').includes('mpegurl') ||
                   forceM3u8 === '1';

    // Para VOE, si después del reintento sigue siendo 403 y enviando HTML, cortamos aquí
    if (upstream.status === 403 && isM3u8 && !isDash) {
        return res.status(403).end();
    }

    res.status(upstream.status);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');

    if (!isM3u8 && !isDash) {
      const contentType = upstream.headers['content-type'] || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      const forwardHeaders = ['content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];
      forwardHeaders.forEach(h => { if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]); });
      (upstream.data as NodeJS.ReadableStream).pipe(res);
      return;
    }

    // Recopilar el cuerpo del manifest y procesarlo
    res.setHeader('Content-Type', isDash ? 'application/dash+xml' : 'application/vnd.apple.mpegurl');
    res.setHeader('X-Cache', 'MISS');
    let body = '';
    (upstream.data as NodeJS.ReadableStream).on('data', (chunk: Buffer) => { body += chunk; });
    (upstream.data as NodeJS.ReadableStream).on('end', () => {

      // ── DASH (.mpd) ──
      if (isDash) {
        const host  = req.get('host');
        const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
        const proxyBase = `${proto}://${host}/proxy?referer=${encodeURIComponent(decodedReferer)}&type=dash&url=`;

        body = body.replace(/(<BaseURL>)(.*?)(<\/BaseURL>)/gi, (_m: string, p1: string, p2: string, p3: string) => {
          const absoluteUrl = urlLib.resolve(decodedUrl, p2);
          return `${p1}${proxyBase}${encodeURIComponent(absoluteUrl)}${p3}`;
        });
        body = body.replace(/media="(.*?)"/gi, (_m: string, p1: string) => {
          const absoluteUrl = urlLib.resolve(decodedUrl, p1);
          return `media="${proxyBase}${encodeURIComponent(absoluteUrl)}"`;
        });
        body = body.replace(/initialization="(.*?)"/gi, (_m: string, p1: string) => {
          const absoluteUrl = urlLib.resolve(decodedUrl, p1);
          return `initialization="${proxyBase}${encodeURIComponent(absoluteUrl)}"`;
        });
        return sendCompressed(req, res, body);
      }

      // ── VALIDACIÓN ESTRICTA M3U8 (Evitar parsear HTML de error) ──
      if (!body.includes('#EXTM3U')) {
          console.error(`[Proxy] ❌ Contenido M3U8 Inválido (Posible 403 HTML oculto).`);
          return res.end(); // Retorna vacío en lugar de enviar basura
      }

      let processed = rewriteM3u8(body, decodedUrl, '/proxy', decodedReferer);

      // wrapM3u8: Si el m3u8 es una playlist de un solo nivel (sin #EXT-X-STREAM-INF),
      // lo envolvemos en un master sintético para que el reproductor muestre la calidad correcta.
      if (wrapLevel && processed.includes('#EXTINF') && !processed.includes('#EXT-X-STREAM-INF')) {
        const levelName = decodeURIComponent(wrapLevel);  // ej. "720p"
        const resMap    = { '1080p': '1920x1080', '720p': '1280x720', '480p': '854x480', '360p': '640x360' };
        const res2      = (resMap as Record<string, string>)[levelName] || '1280x720';
        const bwMap     = { '1080p': '4000000', '720p': '2000000', '480p': '1000000', '360p': '500000' };
        const bw        = (bwMap as Record<string, string>)[levelName] || '2000000';
        // La playlist real ya está reescrita con rutas de proxy; la apuntamos directamente
        const innerUrl  = `/proxy?url=${encodeURIComponent(decodedUrl)}&referer=${encodeURIComponent(decodedReferer)}&forceM3u8=1`;
        processed = [
          '#EXTM3U',
          '#EXT-X-VERSION:3',
          `#EXT-X-STREAM-INF:BANDWIDTH=${bw},RESOLUTION=${res2},NAME="${levelName}"`,
          innerUrl,
        ].join('\n');
        setCache(decodedUrl + '?wrap=' + levelName, processed);
      } else if (processed.includes('#EXT-X-STREAM-INF') || processed.includes('#EXT-X-MEDIA')) {
        setCache(decodedUrl, processed);
      }

      sendCompressed(req, res, processed);
    });

  } catch (err) {
    if (!res.headersSent) res.status(404).end();
  }
}

// ── Envío con compresión gzip si el cliente la soporta ──
function sendCompressed(req: Request, res: Response, text: string): void {
    const acceptEncoding = (req.headers['accept-encoding'] as string) || '';
    if (acceptEncoding.includes('gzip')) {
        zlib.gzip(Buffer.from(text, 'utf8'), (err, compressed) => {
            if (err) {
                res.end(text);
                return;
            }
            res.setHeader('Content-Encoding', 'gzip');
            res.setHeader('Content-Length', compressed.length);
            res.end(compressed);
        });
    } else {
        res.end(text);
    }
}

module.exports = { proxyHandler };