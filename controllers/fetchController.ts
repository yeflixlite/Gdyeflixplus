/**
 * ============================================================
 *  controllers/fetchController.ts
 *  Proxy genérico para obtener HTML de otras webs evadiendo CORS
 *  y detectando Iframes en PelisJuanita
 * ============================================================
 */

'use strict';

import { Request, Response } from 'express';
const { fetchWithRetry } = require('../utils/axiosClient');
const { getBrowserHeaders } = require('../utils/browserHeaders');
const cheerio = require('cheerio');
const url = require('url');

async function fetchUrl(req: Request, res: Response): Promise<any> {
  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    return res.status(400).send('Falta parámetro url');
  }

  // PelisJuanita usa hashes (ej: #L21vdmllLzUxOTE4) y req.query no los lee (es un anchor local),
  // por eso si viene `hash` por query o lo inferimos, lo agregamos a targetUrl.
  const hash = req.query.hash as string;
  const fullUrl = hash ? `${targetUrl}#${hash}` : targetUrl;

  try {
    const originUrl = new URL(targetUrl).origin;
    const isPelisJuanita = fullUrl.includes('pelisjuanita');

    const headers = getBrowserHeaders(originUrl, originUrl);

    console.log(`[FetchController] 🔍 Obteniendo URL: ${fullUrl}`);

    const response = await fetchWithRetry(fullUrl, {
        headers,
        timeout: 10000
    });

    let html = response.data as string;

    // Si es PelisJuanita, interceptar el HTML y extraer el Iframe principal
    if (isPelisJuanita) {
        console.log(`[FetchController] 🎬 PelisJuanita detectada, inyectando scripts y buscando Iframes...`);
        const $ = cheerio.load(html);

        // Remover ads y banners para que cargue más rápido y limpio
        $('script[src*="adsterra"]').remove();
        $('script[src*="popads"]').remove();
        $('.ad-container').remove();

        // Encontrar iframes de video (Streamwish, Filemoon, etc)
        const iframes: string[] = [];
        $('iframe').each((_: number, el: unknown) => {
            const src = $(el).attr('src');
            if (src && !src.includes('youtube') && !src.includes('facebook')) {
                iframes.push(src);
            }
        });

        if (iframes.length > 0) {
            console.log(`[FetchController] ✅ Encontrados ${iframes.length} iframes.`);
            // Añadimos un script para comunicar los iframes detectados al frontend
            const iframesJson = JSON.stringify(iframes);
            $('body').append(`
                <script>
                    console.log("Iframes detectados:", ${iframesJson});
                    window.parent.postMessage({ type: 'iframes_detected', iframes: ${iframesJson} }, '*');
                </script>
            `);
        } else {
             // Si no hay iframes directos, PelisJuanita suele cargar por Ajax.
             // Aquí le enviamos el HTML igual para que se procese, pero interceptamos window.open
             $('body').append(`
                <script>
                    const originalOpen = window.open;
                    window.open = function(url, windowName, windowFeatures) {
                        console.log("PelisJuanita intentó abrir:", url);
                        if (url && (url.includes('wish') || url.includes('moon') || url.includes('hide'))) {
                             window.parent.postMessage({ type: 'iframes_detected', iframes: [url] }, '*');
                             return null; // Evitar popups
                        }
                        return originalOpen.apply(this, arguments);
                    };
                </script>
            `);
        }

        html = $.html();
    }

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);

  } catch (error) {
    console.error(`[FetchController] Error en proxy fetch:`, (error as Error).message);
    res.status(500).send(`Error fetching URL: ${(error as Error).message}`);
  }
}

module.exports = { fetchUrl };
