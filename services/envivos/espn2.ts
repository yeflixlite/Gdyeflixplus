/**
 * services/envivos/espn2.ts
 */
'use strict';

import { ExtractResult } from '../../types';
const { extractChannel } = require('./ksdExtractor');

async function extract(): Promise<ExtractResult> {
    return await extractChannel('espn2');
}

module.exports = { extract };
