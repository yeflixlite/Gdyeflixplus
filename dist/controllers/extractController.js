/**
 * ============================================================
 *  controllers/extractController.ts
 *  Endpoint: GET /extract?url=...
 *  Extrae la info del video y la devuelve en formato JSON
 * ============================================================
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { detectProvider } = require('../utils/urlDetector');
const streamwish = require('../services/streamwish');
const vidhide = require('../services/vidhide');
const filemoon = require('../services/filemoon');
const voe = require('../services/voe');
const doodstream = require('../services/doodstream');
const streamtape = require('../services/streamtape');
const dailymotion = require('../services/dailymotion');
const earvids = require('../services/earvids');
const nupload = require('../services/nupload');
const generic = require('../services/generic');
// Importar servicios en vivo (ejemplo)
const espn2 = require('../services/envivos/espn2');
const tudn = require('../services/envivos/tudn');
const tycsports = require('../services/envivos/tycsports');
const telemundo = require('../services/envivos/telemundo');
async function extractVideo(req, res) {
    const url = req.query.url;
    if (!url) {
        return res.status(400).json({ ok: false, error: 'Falta parámetro url' });
    }
    const provider = detectProvider(url);
    console.log(`[ExtractController] Detectado proveedor: ${provider} para ${url}`);
    let extractor;
    switch (provider) {
        case 'streamwish':
        case 'hgcloud':
            extractor = streamwish;
            break;
        case 'vidhide':
            extractor = vidhide;
            break;
        case 'filemoon':
            extractor = filemoon;
            break;
        case 'voe':
            extractor = voe;
            break;
        case 'doodstream':
            extractor = doodstream;
            break;
        case 'streamtape':
            extractor = streamtape;
            break;
        case 'dailymotion':
            extractor = dailymotion;
            break;
        case 'earvids':
            extractor = earvids;
            break;
        case 'nupload':
            extractor = nupload;
            break;
        case 'mp4upload':
        case 'direct':
        case 'unknown':
        default:
            extractor = generic;
            break;
    }
    try {
        const result = await extractor.extract(url);
        const host = req.get('host');
        const proto = req.headers['x-forwarded-proto'] || req.protocol;
        // Generar la URL final del proxy
        const proxyUrl = `${proto}://${host}/proxy?url=${encodeURIComponent(result.videoUrl)}` +
            `&referer=${encodeURIComponent(result.referer || '')}` +
            (result.wrapLevel ? `&wrap=${result.wrapLevel}` : '');
        const isHlsTxt = result.videoUrl.includes('master.txt') || result.videoUrl.includes('playlist.txt');
        const response = {
            ok: true,
            videoUrl: result.videoUrl,
            proxyUrl,
            type: result.type,
            provider,
            isHlsTxt,
            method: result.method || null
        };
        res.json(response);
    }
    catch (error) {
        console.error(`[ExtractController] Error extrayendo ${url}:`, error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
}
/**
 * Endpoint para extraer canales de TV en vivo
 * GET /api/tv/extract?id=...
 */
async function extractTv(req, res) {
    const id = req.query.id;
    if (!id) {
        return res.status(400).json({ ok: false, error: 'Falta parámetro id de canal' });
    }
    try {
        let result;
        switch (id.toLowerCase()) {
            case 'espn2':
                result = await espn2.extract();
                break;
            case 'tudn':
                result = await tudn.extract();
                break;
            case 'tycsports':
                result = await tycsports.extract();
                break;
            case 'telemundo':
                result = await telemundo.extract();
                break;
            default:
                return res.status(404).json({ ok: false, error: 'Canal no soportado' });
        }
        const host = req.get('host');
        const proto = req.headers['x-forwarded-proto'] || req.protocol;
        // Generar proxy URL
        let proxyUrl = `${proto}://${host}/proxy?url=${encodeURIComponent(result.videoUrl)}` +
            `&referer=${encodeURIComponent(result.referer || '')}`;
        if (result.type === 'dash') {
            proxyUrl += `&type=dash`;
        }
        const response = {
            videoUrl: result.videoUrl,
            proxyUrl,
            type: result.type,
            provider: id,
            drm: result.drm || null
        };
        res.json(response);
    }
    catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
}
module.exports = { extractVideo, extractTv };
