/**
 * ============================================================
 *  server.ts
 *  Proxy de Video Server - Entry Point
 * ============================================================
 */

'use strict';

import express from 'express';
import path from 'path';

const corsMiddleware = require('cors');
const { embedHandler } = require('./controllers/embedController');

const app = express();
const PORT = process.env.PORT || 3000;

// Confianza en el proxy para Render/HTTPS
app.set('trust proxy', true);

// ── Middlewares globales ──────────────────────────────────────
app.use(corsMiddleware({
    origin: '*',
    methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'x-requested-with', 'x-embed-parent', 'X-Captcha-Token'],
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Type']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const isDist = __dirname.endsWith('dist');
const publicPath = isDist ? path.join(__dirname, '../public') : path.join(__dirname, 'public');

// Servir archivos estáticos
app.use(express.static(publicPath));

// ── Rutas de la API ───────────────────────────────────────────
const playRoutes = require('./routes/play');
const proxyRoutes = require('./routes/proxy');
const extractRoutes = require('./routes/extract');
const fetchRoutes = require('./routes/fetch');
const tvRoutes = require('./routes/tv');

app.use('/play', playRoutes);
app.use('/proxy', proxyRoutes);
app.use('/extract', extractRoutes);
app.use('/fetch', fetchRoutes);
app.use('/api/tv', tvRoutes); // Rutas de canales en vivo

// Servir reproductor dedicado para TV (live.html)
app.get('/live', (req: express.Request, res: express.Response) => {
    res.sendFile(path.join(publicPath, 'live.html'));
});

// Ruta para compartir/embedear: /v?url=...
app.get('/v', embedHandler);

// Para Vercel (opcional si se despliega allí)
app.get('/', (req: express.Request, res: express.Response) => {
    res.sendFile(path.join(publicPath, 'index.html'));
});

// ── Manejador de errores global ───────────────────────────────
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[ERROR]', err.message || err);
    if (res.headersSent) return;
    res.status(500).json({
        ok: false,
        error: err.message || 'Error interno del servidor'
    });
});

// Listener (Solo si no es exportado para serverless como Vercel)
if (process.env.NODE_ENV !== 'production' || process.env.RENDER) {
    app.listen(PORT, () => {
        console.log(`\n[Server] Proxy de Video HLS corriendo en el puerto ${PORT}`);
        console.log(`[Server] Abre el reproductor en http://localhost:${PORT}/\n`);
    });
}

module.exports = app;