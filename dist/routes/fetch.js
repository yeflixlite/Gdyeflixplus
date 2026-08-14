"use strict";
/**
 * ============================================================
 *  routes/fetch.ts
 * ============================================================
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const { fetchUrl } = require('../controllers/fetchController');
const router = express_1.default.Router();
// GET /fetch?url=...
router.get('/', fetchUrl);
module.exports = router;
