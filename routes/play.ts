/**
 * ============================================================
 *  routes/play.ts
 * ============================================================
 */

import express from 'express';
const { getPlayUrl } = require('../controllers/playController');
const { getEmbedHtml } = require('../controllers/embedController');

const router = express.Router();

// GET /play?url=... -> JSON (Video y Proxy Urls)
router.get('/', getPlayUrl);

// GET /v?url=... -> HTML (Plyr Player)
router.get('/v', getEmbedHtml);

module.exports = router;
