/**
 * services/envivos/tudn.ts
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { extractChannel } = require('./ksdExtractor');
async function extract() {
    return await extractChannel('tudn');
}
module.exports = { extract };
