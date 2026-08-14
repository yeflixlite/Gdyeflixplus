/**
 * services/envivos/tudn.ts
 */
'use strict';

import { ExtractResult } from '../../types';
const { extractChannel } = require('./ksdExtractor');

async function extract(): Promise<ExtractResult> {
    return await extractChannel('tudn');
}

module.exports = { extract };
