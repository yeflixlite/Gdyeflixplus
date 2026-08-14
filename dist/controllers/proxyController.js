/**
 * ============================================================
 *  controllers/proxyController.ts
 *  Proxy de Video / HLS que soluciona los problemas de CORS.
 * ============================================================
 */
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const url_1 = __importDefault(require("url"));
const { getMediaHeaders } = require('../utils/browserHeaders');
const HttpsProxyAgent = require('https-proxy-agent');
const http = require('http');
const https = require('https');
// Pool de agentes para reutilizar conexiones (Keep-Alive)
const agentOptions = { keepAlive: true, maxSockets: 50 };
const httpAgent = new http.Agent(agentOptions);
const httpsAgent = new https.Agent(agentOptions);
/**
 * Proxy principal para archivos HLS y Video.
 */
async function proxyVideo(req, res) {
    const targetUrl = req.query.url;
    const referer = req.query.referer || '';
    const isDash = req.query.type === 'dash';
    const wrapLevel = req.query.wrap;
    const embedUrl = req.query.embed_url || ''; // Para re-extracción VOE en caso de 403
    if (!targetUrl)
        return res.status(400).send('Error: Falta URL');
    try {
        const origin = referer ? new URL(referer).origin : new URL(targetUrl).origin;
        const isM3u8 = targetUrl.includes('.m3u8') || targetUrl.includes('.txt') || isDash;
        const reqHeaders = {
            ...getMediaHeaders(referer, origin),
            'Accept': isM3u8 ? '*/*' : 'video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5'
        };
        // Detectar proveedor basado en la URL
        const isVoe = targetUrl.includes('voe') || targetUrl.includes('ugc-cdn-caching') || targetUrl.includes('cloudwindow-route') || targetUrl.includes('hls2-c');
        const isStreamwish = targetUrl.includes('streamwish') || targetUrl.includes('premilkyway') || targetUrl.includes('goldenfieldcreativeworks');
        // SOLO enviar X-Forwarded-For en Streamwish para evitar el rate-limit de IP dual.
        // En VOE estropea la comprobación de IP y causa 403.
        if (isStreamwish) {
            if (req.headers['x-forwarded-for']) {
                reqHeaders['X-Forwarded-For'] = req.headers['x-forwarded-for'];
            }
            if (req.headers['x-real-ip']) {
                reqHeaders['X-Real-IP'] = req.headers['x-real-ip'];
            }
        }
        if (req.headers.range)
            reqHeaders['Range'] = req.headers.range;
        // AXIOS REQUEST
        const response = await (0, axios_1.default)({
            method: 'GET',
            url: targetUrl,
            headers: reqHeaders,
            responseType: isM3u8 ? 'text' : 'stream',
            maxRedirects: 5,
            validateStatus: () => true, // Permitir cualquier código
            httpAgent,
            httpsAgent,
        });
        // COPIAR HEADERS
        const headersToCopy = ['content-type', 'content-length', 'accept-ranges', 'content-range', 'cache-control'];
        headersToCopy.forEach(h => {
            if (response.headers[h])
                res.set(h, response.headers[h]);
        });
        res.set('Access-Control-Allow-Origin', '*');
        // HLS / M3U8 PROCESSING
        if (isM3u8) {
            let body = response.data;
            // Validar que la respuesta sea M3U8 real (no una página HTML de error 403)
            const isValidM3u8 = typeof body === 'string' && (body.trimStart().startsWith('#EXTM3U') ||
                body.includes('#EXT-X-') ||
                body.includes('#EXTINF'));
            // Si la validación falla, intentar re-extracción para VOE
            if (!isValidM3u8 && isVoe && embedUrl) {
                console.log(`[Proxy] VOE 403 detectado. Re-extrayendo desde: ${embedUrl}`);
                try {
                    const voe = require('../services/voe');
                    const freshResult = await voe.extract(embedUrl);
                    // Reintentar con la URL fresca (misma IP de esta función)
                    const freshResponse = await (0, axios_1.default)({
                        method: 'GET',
                        url: freshResult.videoUrl,
                        headers: reqHeaders,
                        responseType: 'text',
                        maxRedirects: 5,
                        validateStatus: () => true,
                        httpAgent,
                        httpsAgent,
                    });
                    body = freshResponse.data;
                    const isNowValid = typeof body === 'string' && (body.trimStart().startsWith('#EXTM3U') ||
                        body.includes('#EXT-X-') ||
                        body.includes('#EXTINF'));
                    if (!isNowValid) {
                        console.error(`[Proxy] Re-extracción VOE también falló (status=${freshResponse.status})`);
                        res.set('Content-Type', 'application/json');
                        return res.status(freshResponse.status || 403).json({ error: 'VOE: El CDN sigue rechazando la solicitud tras re-extraer.' });
                    }
                    console.log('[Proxy] VOE re-extracción exitosa.');
                }
                catch (reExtractErr) {
                    console.error('[Proxy] Error en re-extracción VOE:', reExtractErr.message);
                    res.set('Content-Type', 'application/json');
                    return res.status(503).json({ error: 'VOE: No se pudo re-extraer el enlace.' });
                }
            }
            else if (!isValidM3u8) {
                const statusCode = response.status !== 200 ? response.status : 403;
                console.error(`[Proxy] Respuesta no-M3U8 (status=${response.status}) para: ${targetUrl.substring(0, 80)}`);
                res.set('Content-Type', 'application/json');
                return res.status(statusCode).json({ error: `El CDN devolvió un error (${statusCode}) en lugar del playlist M3U8.` });
            }
            res.status(200);
            const host = req.get('host');
            const proto = req.headers['x-forwarded-proto'] || req.protocol;
            // Incluir embed_url en el proxyBase para que las sub-playlists puedan re-extraer también
            const embedParam = embedUrl ? `&embed_url=${encodeURIComponent(embedUrl)}` : '';
            const proxyBase = `${proto}://${host}/proxy?referer=${encodeURIComponent(referer)}${embedParam}&url=`;
            if (isDash) {
                // Rewrite DASH (.mpd)
                body = body.replace(/(<BaseURL>)(.*?)(<\/BaseURL>)/gi, (match, p1, p2, p3) => {
                    const absoluteUrl = url_1.default.resolve(targetUrl, p2);
                    return `${p1}${proxyBase}${encodeURIComponent(absoluteUrl)}&type=dash${p3}`;
                });
                body = body.replace(/media="(.*?)"/gi, (match, p1) => {
                    const absoluteUrl = url_1.default.resolve(targetUrl, p1);
                    return `media="${proxyBase}${encodeURIComponent(absoluteUrl)}&type=dash"`;
                });
                body = body.replace(/initialization="(.*?)"/gi, (match, p1) => {
                    const absoluteUrl = url_1.default.resolve(targetUrl, p1);
                    return `initialization="${proxyBase}${encodeURIComponent(absoluteUrl)}&type=dash"`;
                });
            }
            else {
                // Rewrite HLS (.m3u8)
                body = body.split('\n').map(line => {
                    const trimmed = line.trim();
                    if (trimmed === '')
                        return line;
                    // Extraer lógica para hacer las URLs absolutas
                    const makeAbsolute = (uri) => {
                        if (uri.startsWith('http'))
                            return uri;
                        const basePath = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
                        return uri.startsWith('/') ? new URL(targetUrl).origin + uri : basePath + uri;
                    };
                    // Reescribir URI="..." dentro de las etiquetas #EXT (ej. #EXT-X-MEDIA para audios)
                    if (trimmed.startsWith('#')) {
                        if (trimmed.includes('URI="')) {
                            return trimmed.replace(/URI="(.*?)"/gi, (match, uri) => {
                                const absolute = makeAbsolute(uri);
                                if (absolute.includes('.m3u8') || absolute.includes('.txt')) {
                                    return `URI="${proxyBase}${encodeURIComponent(absolute)}"`;
                                }
                                // Streamwish: sus CDN tienen CORS → bypass directo evita stuttering
                                // Voe y otros: sus CDN NO tienen CORS → deben pasar por el proxy
                                if (isStreamwish)
                                    return `URI="${absolute}"`;
                                return `URI="${proxyBase}${encodeURIComponent(absolute)}"`;
                            });
                        }
                        return line;
                    }
                    const absolute = makeAbsolute(trimmed);
                    // Sub-playlists: siempre por el proxy (necesario para reescribir URLs)
                    if (absolute.includes('.m3u8') || absolute.includes('.txt')) {
                        return `${proxyBase}${encodeURIComponent(absolute)}`;
                    }
                    // Fragmentos (.ts, .mp4, etc.)
                    // Streamwish: CDN tiene CORS → bypass directo (velocidad máxima, sin cuello de botella)
                    // Voe y otros: CDN sin CORS → pasar por proxy
                    if (isStreamwish)
                        return absolute;
                    return `${proxyBase}${encodeURIComponent(absolute)}`;
                }).join('\n');
                // Si se necesita envolver un playlist single-level en un master sintético
                if (wrapLevel && !body.includes('#EXT-X-STREAM-INF')) {
                    const masterPlaylist = `#EXTM3U\n` +
                        `#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,NAME="${wrapLevel}"\n` +
                        `data:application/vnd.apple.mpegurl;base64,${Buffer.from(body).toString('base64')}\n`;
                    return res.send(masterPlaylist);
                }
            }
            return res.send(body);
        }
        // VIDEO STREAM (MP4/TS)
        else {
            res.set('Cache-Control', 'public, max-age=86400'); // Cache agresiva para segmentos
            response.data.pipe(res);
        }
    }
    catch (error) {
        console.error(`[Proxy] Error para ${targetUrl}:`, error.message);
        res.status(500).send('Error en el proxy');
    }
}
module.exports = { proxyVideo };
