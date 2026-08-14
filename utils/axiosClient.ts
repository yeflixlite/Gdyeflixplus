/**
 * ============================================================
 *  utils/axiosClient.ts
 *  Cliente Axios pre-configurado para simular un navegador real
 * ============================================================
 */

'use strict';

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { FetchOptions } from '../types';
const { getBrowserHeaders } = require('./browserHeaders');

/**
 * Crea una instancia de Axios que simula Chrome.
 * @param extraHeaders – Headers adicionales a fusionar
 * @param referer      – Referer a inyectar
 * @param origin       – Origin a inyectar
 */
function createClient(
  extraHeaders: Record<string, string> = {},
  referer = '',
  origin  = ''
): AxiosInstance {
  return axios.create({
    timeout: 30_000,                  // 30 segundos máximo
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
async function fetchWithRetry(
  url:     string,
  options: FetchOptions = {},
  retries  = 3
): Promise<AxiosResponse> {
  const client = createClient(
    options.headers  || {},
    options.referer  || '',
    options.origin   || '',
  );

  let lastError: Error = new Error('Unknown error');
  for (let i = 0; i < retries; i++) {
    try {
      const response = await client.get(url, {
        responseType: options.responseType || 'text',
        timeout:      options.timeout      || 30_000,
        httpsAgent:   options.httpsAgent   || undefined,
        httpAgent:    options.httpAgent    || undefined,
      });
      return response;
    } catch (err) {
      lastError = err as Error;
      // Pequeña pausa antes de reintentar
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastError;
}

module.exports = { createClient, fetchWithRetry };
