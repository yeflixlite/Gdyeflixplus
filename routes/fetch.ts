/**
 * ============================================================
 *  routes/fetch.ts
 * ============================================================
 */

import express from 'express';
const { fetchUrl } = require('../controllers/fetchController');

const router = express.Router();

// GET /fetch?url=...
router.get('/', fetchUrl);

module.exports = router;
