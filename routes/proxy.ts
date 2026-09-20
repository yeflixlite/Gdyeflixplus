/**
 * ============================================================
 *  routes/proxy.ts
 * ============================================================
 */

import express from 'express';
const { proxyHandler } = require('../controllers/proxyController');

const router = express.Router();

// GET /proxy?url=...&referer=...
router.get('/', proxyHandler);

module.exports = router;
