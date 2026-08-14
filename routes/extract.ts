/**
 * ============================================================
 *  routes/extract.ts
 * ============================================================
 */

import express from 'express';
const { extractVideo } = require('../controllers/extractController');

const router = express.Router();

// GET /extract?url=...
router.get('/', extractVideo);

module.exports = router;
