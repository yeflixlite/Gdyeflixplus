/**
 * ============================================================
 *  services/voe.ts
 *  Extractor para VOE y sus mirrors (charlestoughrace.com, etc.)
 * ============================================================
 */
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const { fetchWithRetry } = require('../utils/axiosClient');
// Keep-alive agents para conexiones rápidas a espejos
const httpsAgent = new https_1.default.Agent({ keepAlive: true });
const httpAgent = new http_1.default.Agent({ keepAlive: true });
// Caché en memoria para evitar volver a extraer URLs resolubles
const extractionCache = new Map();
// TTL de caché: 60 minutos
const CACHE_TTL = 1000 * 60 * 60;
/* ── Dominios reconocidos de VOE ────────── */
const VOE_DOMAINS = [
    'nicolehappyoutside.com',
    'voe.sx',
    'charlestoughrace.com',
    'reitshof.com',
    'v-o-e.com',
    'voe-video.com',
    'richardquestionbuilding.com',
    'jenniferperformer.com'
];
/**
 * Decodifica el JSON ofuscado de VOE.
 * Basado en la lógica de loader.bc4a6543429.js
 */
function decodeVoeConfig(encoded) {
    try {
        // 1. ROT13
        let str = encoded.replace(/[a-zA-Z]/g, function (c) {
            let code = c.charCodeAt(0) + 13;
            const limit = c <= 'Z' ? 90 : 122;
            return String.fromCharCode(limit >= code ? code : code - 26);
        });
        // 2. Character replacements (limpieza de ruido)
        const noisyTags = ['@$', '^^', '~@', '%?', '*~', '!!', '#&'];
        noisyTags.forEach(tag => {
            str = str.split(tag).join('');
        });
        // 3. Base64 decode 1
        const decoded1 = Buffer.from(str, 'base64').toString('binary');
        // 4. Offset de caracteres (-3)
        let offsetStr = '';
        for (let i = 0; i < decoded1.length; i++) {
            offsetStr += String.fromCharCode(decoded1.charCodeAt(i) - 3);
        }
        // 5. Reverse
        const reversed = offsetStr.split('').reverse().join('');
        // 6. Base64 decode 2
        const finalJson = Buffer.from(reversed, 'base64').toString('utf-8');
        return JSON.parse(finalJson);
    }
    catch (err) {
        console.error('[VOE] Error decodificando config:', err.message);
        return null;
    }
}
/**
 * @param url  URL de la página embed de VOE
 */
async function extract(url) {
    const embedUrl = url;
    const u = new URL(embedUrl);
    const id = u.pathname.split('/').filter(Boolean).pop();
    // CACHE CHECK
    const cacheKey = id + u.search;
    const cached = extractionCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log(`[VOE] ⚡ Resultado obtenido de CACHE en memoria para ID: ${id}`);
        return cached.result;
    }
    // Espejos limpios de VOE y nuevos dominios detectados
    const CLEAN_MIRRORS = [
        'nicolehappyoutside.com',
        'timmaybealready.com',
        'charlestoughrace.com',
        'reitshof.com',
        'richardquestionbuilding.com',
        'jenniferperformer.com',
        'p-v-o-e.com'
    ];
    // Lista de hosts a probar
    const hostsToTry = [u.host, ...CLEAN_MIRRORS];
    const uniqueHosts = [...new Set(hostsToTry)];
    console.log(`[VOE] 🔍 Iniciando búsqueda rápida concurrente (Race) en espejos...`);
    const fetchPromises = uniqueHosts.map(async (testHost) => {
        const testUrl = `https://${testHost}/e/${id}${u.search}`;
        const response = await fetchWithRetry(testUrl, {
            referer: 'https://google.com/',
            origin: `https://${testHost}`,
            timeout: 5000,
            httpsAgent,
            httpAgent
        }, 1);
        let testHtml = response.data;
        // DETECCIÓN DE REDIRECCIÓN POR JS (NUEVA ESTRATEGIA)
        const jsRedirect = testHtml.match(/window\.location\.href\s*=\s*['"](https?:\/\/[^'"]+)['"]/i);
        if (jsRedirect && !testHtml.includes('sources') && !testHtml.includes('voe-video')) {
            const newUrl = jsRedirect[1];
            console.log(`[VOE] ↪️ Siguiendo redirección JS: ${newUrl}`);
            const redirRes = await fetchWithRetry(newUrl, { referer: testUrl, httpsAgent, httpAgent });
            testHtml = redirRes.data;
            const newHost = new URL(newUrl).host;
            if (!uniqueHosts.includes(newHost))
                uniqueHosts.push(newHost);
        }
        // Verificamos si es una página real de video
        if ((testHtml.includes('sources') || testHtml.includes('voe-video') || testHtml.includes('decodeVoeConfig') || testHtml.includes('application/json') || testHtml.includes('decodeURI(')) && !testHtml.includes('Just a moment...')) {
            return {
                html: testHtml,
                finalOrigin: `https://${testHost}`,
                finalEmbedUrl: testUrl,
                host: testHost
            };
        }
        throw new Error(`HTML no válido en espejo ${testHost}`);
    });
    let html = '';
    let finalOrigin = '';
    let finalEmbedUrl = '';
    try {
        const fastestResult = await Promise.any(fetchPromises);
        html = fastestResult.html;
        finalOrigin = fastestResult.finalOrigin;
        finalEmbedUrl = fastestResult.finalEmbedUrl;
        console.log(`[VOE] ✅ ¡ÉXITO HTTP! Host más rápido: ${fastestResult.host}`);
    }
    catch {
        throw new Error(`Bloqueo total en VOE (${u.host}). Los espejos no respondieron con contenido válido.`);
    }
    const host = new URL(finalEmbedUrl).host;
    const origin = finalOrigin;
    const searchParams = new URL(finalEmbedUrl).search;
    let finalVideoUrl = null;
    // ESTRATEGIA 1: Buscar JSON ofuscado (Tradicional)
    const jsonMatch = html.match(/<script type="application\/json">\["([^"]+)"\]<\/script>/);
    if (jsonMatch) {
        const config = decodeVoeConfig(jsonMatch[1]);
        if (config && (config.source || config.file)) {
            finalVideoUrl = config.source || config.file;
            console.log(`[VOE/${host}] ⚡ Decodificación exitosa (Strategy 1).`);
        }
    }
    // ESTRATEGIA 2: Buscar decodeURI ofuscado (NUEVA - 2024/2025)
    if (!finalVideoUrl) {
        const uriMatch = html.match(/decodeURI\(['"]([^'"]+)['"]\)/i);
        if (uriMatch) {
            console.log(`[VOE/${host}] 🧪 Intentando decodificar via decodeURI (Strategy 2)...`);
            try {
                let str = decodeURIComponent(uriMatch[1]);
                // Aplicar el mismo offset de la función tradicional (-3) y reverse
                let offsetStr = '';
                for (let i = 0; i < str.length; i++) {
                    offsetStr += String.fromCharCode(str.charCodeAt(i) - 3);
                }
                const reversed = offsetStr.split('').reverse().join('');
                // Intentar encontrar una URL o un Base64 dentro
                const b64Match = reversed.match(/[A-Za-z0-9+/=]{50,}/);
                if (b64Match) {
                    const decoded = Buffer.from(b64Match[0], 'base64').toString('utf-8');
                    if (decoded.includes('.m3u8') || decoded.includes('.mp4')) {
                        const json = JSON.parse(decoded);
                        finalVideoUrl = json.file || json.source || json.url;
                        console.log(`[VOE/${host}] ⚡ Decodificación exitosa (Strategy 2).`);
                    }
                }
            }
            catch {
                // Siguiente estrategia
            }
        }
    }
    // Fallback 1: buscar m3u8 directo (Base64 simple)
    if (!finalVideoUrl) {
        const b64Candidates = html.match(/['"]([A-Za-z0-9+/=]{50,})['"]/g) || [];
        for (const match of b64Candidates) {
            try {
                const cleanStr = match.replace(/['"]/g, '');
                const decoded = Buffer.from(cleanStr, 'base64').toString('utf-8');
                if (decoded.includes('.m3u8') && (decoded.startsWith('http') || decoded.includes('master.m3u8'))) {
                    finalVideoUrl = decoded;
                    break;
                }
            }
            catch { }
        }
    }
    // Fallback 2: buscar m3u8 directo en HTML
    if (!finalVideoUrl) {
        const directMatch = html.match(/['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['\"]/i);
        if (directMatch)
            finalVideoUrl = directMatch[1];
    }
    if (finalVideoUrl) {
        // Asegurar que los tokens de seguridad originales se mantengan si no están presentes
        if (searchParams && !finalVideoUrl.includes('t=')) {
            const separator = finalVideoUrl.includes('?') ? '&' : '?';
            finalVideoUrl += separator + searchParams.substring(1);
            console.log(`[VOE/${host}] 🛡️ Tokens de seguridad inyectados.`);
        }
        console.log(`[VOE/${host}] ✅ Extraído: ${finalVideoUrl.substring(0, 80)}...`);
        const result = {
            videoUrl: finalVideoUrl,
            type: finalVideoUrl.includes('.m3u8') ? 'm3u8' : 'mp4',
            referer: origin
        };
        extractionCache.set(cacheKey, { timestamp: Date.now(), result });
        return result;
    }
    throw new Error(`No se pudo extraer el enlace de video de VOE (${host}). Es posible que el sitio haya cambiado su estructura.`);
}
module.exports = { extract, VOE_DOMAINS };
