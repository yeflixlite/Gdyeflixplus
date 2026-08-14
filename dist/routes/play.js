"use strict";
/**
 * ============================================================
 *  routes/play.ts
 * ============================================================
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const { getPlayUrl } = require('../controllers/playController');
const { getEmbedHtml } = require('../controllers/embedController');
const router = express_1.default.Router();
// GET /play?url=... -> JSON (Video y Proxy Urls)
router.get('/', getPlayUrl);
// GET /v?url=... -> HTML (Plyr Player)
router.get('/v', getEmbedHtml);
module.exports = router;
