/**
 * ============================================================
 *  controllers/extractController.ts
 *  Endpoint: GET /extract?url=...
 *  Extrae la info del video y la devuelve en formato JSON
 * ============================================================
 */

'use strict';

import { Request, Response } from 'express';
import { ProviderName } from '../utils/urlDetector';
import { ExtractResponse, TvExtractResponse } from '../types';
const { detectProvider }   = require('../utils/urlDetector');
const streamwish           = require('../services/streamwish');
const vidhide              = require('../services/vidhide');
const filemoon             = require('../services/filemoon');
const voe                  = require('../services/voe');
const goodstream           = require('../services/goodstream');
const doodstream           = require('../services/doodstream');
const streamtape           = require('../services/streamtape');
const dailymotion          = require('../services/dailymotion');
const earvids              = require('../services/earvids');
const nupload              = require('../services/nupload');
const generic              = require('../services/generic');

// Importar servicios en vivo (ejemplo)
const espn2                = require('../services/envivos/espn2');
const tudn                 = require('../services/envivos/tudn');
const tycsports            = require('../services/envivos/tycsports');
const telemundo            = require('../services/envivos/telemundo');

// Mapa proveedor → servicio HTTP
const HTTP_SERVICE_MAP: Record<string, any> = {
  streamwish,
  hgcloud     : streamwish,
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

async function extractVideo(req: Request, res: Response): Promise<any> {
  try {
    const { url, mode = 'auto' } = req.query as Record<string, string>;

    if (!url) {
      return res.status(400).json({ ok: false, error: 'Parámetro "url" requerido.' });
    }

    let decodedUrl: string;
    try {
      decodedUrl = decodeURIComponent(url);
      new URL(decodedUrl);
    } catch {
      return res.status(400).json({ ok: false, error: 'La URL proporcionada no es válida.' });
    }

    const provider: ProviderName = detectProvider(decodedUrl);
    console.log(`[Extract] Proveedor detectado: ${provider} → ${decodedUrl}`);

    let result: any = null;
    let method: string | null = null;

    if (mode === 'puppeteer') {
      const puppeteerExtractor = require('../services/puppeteerExtractor');
      result = await puppeteerExtractor.extract(decodedUrl);
      method = 'puppeteer';
    } else if (mode === 'http') {
      const service = HTTP_SERVICE_MAP[provider];
      if (!service) throw new Error(`Proveedor HTTP no soportado: ${provider}`);
      result = await service.extract(decodedUrl);
      method = 'http';
    } else {
      // MODO AUTO: intenta HTTP primero y cae a Puppeteer como respaldo
      const service = HTTP_SERVICE_MAP[provider];
      try {
        if (!service) throw new Error(`Proveedor HTTP no soportado: ${provider}`);
        result = await service.extract(decodedUrl);
        method = 'http';
      } catch (err) {
        console.warn(`[Extract] HTTP falló para ${provider}, intentando Puppeteer...`);
        const puppeteerExtractor = require('../services/puppeteerExtractor');
        result = await puppeteerExtractor.extract(decodedUrl);
        method = 'puppeteer';
      }
    }

    const { videoUrl, type, referer = '' } = result;

    const isHlsTxt = /\.txt(\?|$)/i.test(videoUrl) &&
                     (type === 'm3u8' || /\/hls\/|master|playlist/i.test(videoUrl));

    // SOLUCIÓN DEFINITIVA: Usar ruta relativa.
    // Esto evita que el navegador se queje de Mixed Content (HTTP vs HTTPS).
    const wrapParam = result.wrapLevel ? `&wrapM3u8=${encodeURIComponent(result.wrapLevel)}` : '';
    const proxyUrl = `/proxy?url=${encodeURIComponent(videoUrl)}` +
                     `&referer=${encodeURIComponent(referer)}` +
                     (isHlsTxt ? '&forceM3u8=1' : '') +
                     wrapParam;

    const response: ExtractResponse = {
      ok: true,
      videoUrl,
      proxyUrl,
      type,
      provider,
      isHlsTxt,
      method,
    };

    return res.json(response);

  } catch (err) {
    console.error('[Extract Error]', (err as Error).message);
    return res.status(500).json({ ok: false, error: (err as Error).message });
  }
}

/**
 * Endpoint para extraer canales de TV en vivo
 * GET /api/tv/extract?id=...
 */
async function extractTv(req: Request, res: Response): Promise<any> {
  const id = req.query.id as string;
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Falta parámetro id de canal' });
  }

  try {
    let result: any;

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

    const host  = req.get('host');
    const proto = req.headers['x-forwarded-proto'] || req.protocol;

    // Generar proxy URL
    let proxyUrl = `${proto}://${host}/proxy?url=${encodeURIComponent(result.videoUrl)}` +
                   `&referer=${encodeURIComponent(result.referer || '')}`;

    if (result.type === 'dash') {
      proxyUrl += `&type=dash`;
    }

    const response: TvExtractResponse = {
      videoUrl: result.videoUrl,
      proxyUrl,
      type:     result.type,
      provider: id,
      drm:      result.drm || null
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({ ok: false, error: (error as Error).message });
  }
}

module.exports = { extractVideo, extractTv };