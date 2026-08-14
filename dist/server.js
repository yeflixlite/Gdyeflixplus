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
// Utilizando require para cors al no tener esModuleInterop totalmente configurado a veces
const corsMiddleware = require('cors');
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
// Configuración de CORS más permisiva
app.use(corsMiddleware({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'x-requested-with', 'x-embed-parent', 'X-Captcha-Token'],
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Type']
}));
const isDist = __dirname.endsWith('dist');
const publicPath = isDist ? path_1.default.join(__dirname, '../public') : path_1.default.join(__dirname, 'public');
// Servir archivos estáticos
app.use(express_1.default.static(publicPath));
// Rutas
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
// Para Vercel (opcional si se despliega allí)
app.get('/', (req, res) => {
    res.sendFile(path_1.default.join(publicPath, 'index.html'));
});
// Listener (Solo si no es exportado para serverless como Vercel)
if (process.env.NODE_ENV !== 'production' || process.env.RENDER) {
    app.listen(PORT, () => {
        console.log(`[Server] Proxy de Video HLS corriendo en el puerto ${PORT}`);
    });
}
module.exports = app;
