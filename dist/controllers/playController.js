/**
 * ============================================================
 *  controllers/playController.ts
 *  Endpoint: GET /play?url=...
 *  Orquesta la detección del proveedor y llama al servicio
 *  correcto para obtener el enlace real del video.
 * ============================================================
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { detectProvider } = require('../utils/urlDetector');
const streamwish = require('../services/streamwish');
const vidhide = require('../services/vidhide');
const filemoon = require('../services/filemoon');
const voe = require('../services/voe');
const goodstream = require('../services/goodstream');
const doodstream = require('../services/doodstream');
const streamtape = require('../services/streamtape');
const dailymotion = require('../services/dailymotion');
const earvids = require('../services/earvids');
const nupload = require('../services/nupload');
const generic = require('../services/generic');
// Mapa proveedor → servicio HTTP
const HTTP_SERVICE_MAP = {
    streamwish,
    hgcloud: streamwish,
    vidhide,
    filemoon,
    voe,
    goodstream,
    doodstream,
    streamtape,
    dailymotion,
    earvids,
    nupload,
};
async function getPlayUrl(req, res) {
    try {
        const { url, mode = 'auto' } = req.query;
        if (!url) {
            return res.status(400).json({ error: 'Parámetro "url" requerido.' });
        }
        let decodedUrl;
        try {
            decodedUrl = decodeURIComponent(url);
            new URL(decodedUrl);
        }
        catch {
            return res.status(400).json({ error: 'La URL proporcionada no es válida.' });
        }
        const provider = detectProvider(decodedUrl);
        console.log(`\n[Play] Proveedor detectado: ${provider} → ${decodedUrl}`);
        let result = null;
        let method = null;
        // Lógica de extracción optimizada para VELOCIDAD
        if (mode === 'puppeteer') {
            const puppeteerExtractor = require('../services/puppeteerExtractor');
            result = await puppeteerExtractor.extract(decodedUrl);
            method = 'puppeteer';
        }
        else if (mode === 'http') {
            const service = HTTP_SERVICE_MAP[provider];
            if (!service)
                throw new Error(`Proveedor HTTP no soportado: ${provider}`);
            result = await service.extract(decodedUrl);
            method = 'http';
        }
        else {
            // MODO AUTO: Siempre intenta HTTP primero (1s) antes de ir a Puppeteer (15s)
            try {
                const service = HTTP_SERVICE_MAP[provider];
                if (!service)
                    throw new Error(`Proveedor HTTP no soportado: ${provider}`);
                result = await service.extract(decodedUrl);
                method = 'http';
            }
            catch (err) {
                // Si el servicio ya usa Puppeteer por dentro y falló, no tiene sentido usar el genérico
                if (provider === 'doodstream') {
                    throw new Error(`Fallo en la extracción dedicada: ${err.message}`);
                }
                console.warn(`[Play] HTTP falló para ${provider}, intentando Puppeteer como fallback...`);
                try {
                    const puppeteerExtractor = require('../services/puppeteerExtractor');
                    result = await puppeteerExtractor.extract(decodedUrl);
                    method = 'puppeteer';
                }
                catch (puppErr) {
                    // Si falla el require de puppeteer (en Vercel por ejemplo)
                    if (puppErr.message.includes('Cannot find module')) {
                        throw new Error(`Fallo en HTTP: ${err.message}. Puppeteer no está disponible en este servidor.`);
                    }
                    throw new Error(`Fallo total. HTTP: ${err.message}. Puppeteer: ${puppErr.message}`);
                }
            }
        }
        // Construye la URL de proxy (relativa para evitar problemas de HTTPS/Mixed Content)
        const encodedVideoUrl = encodeURIComponent(result.videoUrl);
        const encodedReferer = encodeURIComponent(result.referer || '');
        const isHlsTxt = /\.txt(\?|$)/i.test(result.videoUrl);
        // wrapLevel: cuando el servicio indica que el m3u8 es single-level (sin #EXT-X-STREAM-INF)
        // el proxy generará un master sintético con la calidad indicada (ej. "720p")
        const wrapParam = result.wrapLevel ? `&wrapM3u8=${encodeURIComponent(result.wrapLevel)}` : '';
        let proxyUrl = `/proxy?url=${encodedVideoUrl}&referer=${encodedReferer}${isHlsTxt ? '&forceM3u8=1' : ''}${wrapParam}`;
        // Para VOE: pasar la URL original del embed para que el proxy pueda
        // re-extraer en el mismo proceso (misma IP) si el CDN devuelve 403 (IP binding)
        if (provider === 'voe') {
            proxyUrl += `&embed_url=${encodeURIComponent(decodedUrl)}`;
        }
        // ÓPTIMO DE BANDA (StreamWish / VidHide / Filemoon): el proveedor ya
        // entrega un HLS/m3u8 completo y reproducible, así que el reproductor puede
        // consumir ese HLS DIRECTAMENTE desde el CDN del proveedor (sus segmentos NO
        // pasan por el servidor, Data Transfer ≈ 0). El proxy solo se usa como respaldo.
        //
        // VOE excluido (16/09/2026): su CDN *.cloudwindow-route.com ya NO responde
        // Access-Control-Allow-Origin desde el navegador y los tokens quedan ligados
        // a la IP del servidor → 403/CORS en directo. Todo el tráfico VOE pasa por
        // /proxy (con hot-swap en caso de 403).
        const directPlay = (provider === 'streamwish' || provider === 'hgcloud' ||
            provider === 'vidhide' || provider === 'filemoon') &&
            result.type === 'm3u8';
        const response = {
            videoUrl: result.videoUrl,
            proxyUrl,
            directPlay,
            type: result.type,
            provider,
            method,
        };
        return res.json(response);
    }
    catch (err) {
        console.error('[Play Error]', err.message);
        return res.status(500).json({ error: err.message });
    }
}
module.exports = { getPlayUrl, playHandler: getPlayUrl };
