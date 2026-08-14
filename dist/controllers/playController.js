/**
 * ============================================================
 *  controllers/playController.ts
 *  Endpoint: GET /play?url=...
 *  Extrae la URL del video y devuelve un objeto JSON compatible con el Player
 * ============================================================
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { detectProvider } = require('../utils/urlDetector');
const extractController = require('./extractController');
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
// Envivos
const espn2 = require('../services/envivos/espn2');
async function getPlayUrl(req, res) {
    const url = req.query.url;
    if (!url) {
        return res.status(400).json({ error: 'Falta parámetro url' });
    }
    const provider = detectProvider(url);
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
        let proxyUrl = `${proto}://${host}/proxy?url=${encodeURIComponent(result.videoUrl)}` +
            `&referer=${encodeURIComponent(result.referer || '')}` +
            (result.wrapLevel ? `&wrap=${result.wrapLevel}` : '');
        // Para VOE: pasar la URL original del embed para que el proxy pueda
        // re-extraer en el mismo proceso (misma IP) si el CDN devuelve 403 (IP binding)
        if (provider === 'voe') {
            proxyUrl += `&embed_url=${encodeURIComponent(url)}`;
        }
        const response = {
            videoUrl: result.videoUrl,
            proxyUrl,
            type: result.type,
            provider,
            method: result.method || null
        };
        res.json(response);
    }
    catch (error) {
        console.error(`[PlayController] Error extrayendo ${url}:`, error.message);
        res.status(500).json({ error: error.message });
    }
}
module.exports = { getPlayUrl };
