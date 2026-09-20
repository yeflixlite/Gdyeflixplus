/**
 * ============================================================
 *  server.ts
 *  Proxy de Video Server - Entry Point
 * ============================================================
 */
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const corsMiddleware = require('cors');
const { embedHandler } = require('./controllers/embedController');
const app = (0, express_1.default)();
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
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
const isDist = __dirname.endsWith('dist');
const publicPath = isDist ? path_1.default.join(__dirname, '../public') : path_1.default.join(__dirname, 'public');
// Servir archivos estáticos
app.use(express_1.default.static(publicPath));
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
app.get('/live', (req, res) => {
    res.sendFile(path_1.default.join(publicPath, 'live.html'));
});
// Ruta para compartir/embedear: /v?url=...
app.get('/v', embedHandler);
// Para Vercel (opcional si se despliega allí)
app.get('/', (req, res) => {
    res.sendFile(path_1.default.join(publicPath, 'index.html'));
});
// ── Manejador de errores global ───────────────────────────────
app.use((err, req, res, _next) => {
    console.error('[ERROR]', err.message || err);
    if (res.headersSent)
        return;
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
