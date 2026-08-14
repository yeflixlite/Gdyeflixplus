/**
 * ============================================================
 *  routes/tv.ts
 * ============================================================
 */

import express from 'express';
const { extractTv } = require('../controllers/extractController');

const router = express.Router();

// GET /api/tv/extract?id=...
router.get('/extract', extractTv);

module.exports = router;
