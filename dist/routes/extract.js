"use strict";
/**
 * ============================================================
 *  routes/extract.ts
 * ============================================================
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const { extractVideo } = require('../controllers/extractController');
const router = express_1.default.Router();
// GET /extract?url=...
router.get('/', extractVideo);
module.exports = router;
