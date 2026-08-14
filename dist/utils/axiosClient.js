/**
 * ============================================================
 *  utils/axiosClient.ts
 *  Cliente Axios pre-configurado para simular un navegador real
 * ============================================================
 */
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const { getBrowserHeaders } = require('./browserHeaders');
/**
 * Crea una instancia de Axios que simula Chrome.
 * @param extraHeaders – Headers adicionales a fusionar
 * @param referer      – Referer a inyectar
 * @param origin       – Origin a inyectar
 */
function createClient(extraHeaders = {}, referer = '', origin = '') {
    return axios_1.default.create({
        timeout: 30000, // 30 segundos máximo
        maxRedirects: 10,
        decompress: true,
        headers: {
            ...getBrowserHeaders(referer, origin),
            ...extraHeaders,
        },
        // Permite cualquier código de estado para manejarlos manualmente
        validateStatus: () => true,
    });
}
/**
 * Realiza un GET con reintentos automáticos.
 * @param url
 * @param options – { headers, referer, origin, responseType }
 * @param retries
 */
async function fetchWithRetry(url, options = {}, retries = 3) {
    const client = createClient(options.headers || {}, options.referer || '', options.origin || '');
    let lastError = new Error('Unknown error');
    for (let i = 0; i < retries; i++) {
        try {
            const response = await client.get(url, {
                responseType: options.responseType || 'text',
                timeout: options.timeout || 30000,
                httpsAgent: options.httpsAgent || undefined,
                httpAgent: options.httpAgent || undefined,
            });
            return response;
        }
        catch (err) {
            lastError = err;
            // Pequeña pausa antes de reintentar
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
    throw lastError;
}
module.exports = { createClient, fetchWithRetry };
