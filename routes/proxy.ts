/**
 * ============================================================
 *  routes/proxy.ts
 * ============================================================
 */

import express from 'express';
const { proxyVideo } = require('../controllers/proxyController');

const router = express.Router();

// GET /proxy?url=...&referer=...
router.get('/', proxyVideo);

module.exports = router;
