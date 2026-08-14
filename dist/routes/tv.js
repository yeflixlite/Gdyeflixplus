"use strict";
/**
 * ============================================================
 *  routes/tv.ts
 * ============================================================
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const { extractTv } = require('../controllers/extractController');
const router = express_1.default.Router();
// GET /api/tv/extract?id=...
router.get('/extract', extractTv);
module.exports = router;
