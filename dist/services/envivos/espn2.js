/**
 * services/envivos/espn2.ts
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { extractChannel } = require('./ksdExtractor');
async function extract() {
    return await extractChannel('espn2');
}
module.exports = { extract };
