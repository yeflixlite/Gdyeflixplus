/**
 * services/envivos/tycsports.ts
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { extractChannel } = require('./ksdExtractor');
async function extract() {
    return await extractChannel('tycsports');
}
module.exports = { extract };
