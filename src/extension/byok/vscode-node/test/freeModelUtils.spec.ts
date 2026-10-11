/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 JahCopilotChat contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
	getOpenCodeZenModelFormat,
	isExplicitlyFreeModel,
	isKiloGatewayFreeModel,
	isNvidiaNimFreeModel,
	isOpenCodeZenFreeModel,
	isOpenRouterFreeModel,
} from '../../common/freeModelUtils';

describe('free model catalog filters', () => {
	it('recognizes conventional free model ID variants', () => {
		expect(isExplicitlyFreeModel({ id: 'provider/model:free' })).toBe(true);
		expect(isExplicitlyFreeModel({ id: 'model-name-free' })).toBe(true);
		expect(isExplicitlyFreeModel({ id: 'provider/free-model' })).toBe(true);
	});

	it('recognizes explicit free catalog labels and flags', () => {
		expect(isExplicitlyFreeModel({ id: 'nvidia/model', free_endpoint: true })).toBe(true);
		expect(isExplicitlyFreeModel({ id: 'nvidia/model', badges: ['Free Endpoint'] })).toBe(true);
		expect(isExplicitlyFreeModel({ id: 'nvidia/model', description: 'Free inference endpoint' })).toBe(true);
	});

	it('treats models as free only when both input and output are explicitly zero-priced', () => {
		expect(isExplicitlyFreeModel({
			id: 'provider/free-model',
			pricing: { prompt: '0', completion: '0.0' },
		})).toBe(true);
		expect(isExplicitlyFreeModel({ id: 'provider/model', pricing: { prompt: 0, completion: 0 } })).toBe(true);
		expect(isExplicitlyFreeModel({ id: 'provider/model', pricing: { prompt: 0, completion: 0.000001 } })).toBe(false);
		expect(isExplicitlyFreeModel({ id: 'provider/model', pricing: { prompt: 0 } })).toBe(false);
		expect(isExplicitlyFreeModel({ id: 'provider/unpriced-model' })).toBe(false);
	});

	it('handles provider-specific free catalog entries and auto routers', () => {
		expect(isOpenRouterFreeModel({ id: 'openrouter/free' })).toBe(true);
		expect(isOpenRouterFreeModel({ id: 'provider/paid-model', pricing: { prompt: 1, completion: 1 } })).toBe(false);
		expect(isOpenCodeZenFreeModel({ id: 'big-pickle' })).toBe(true);
		expect(isKiloGatewayFreeModel({ id: 'kilo-auto/free' })).toBe(true);
		expect(isNvidiaNimFreeModel({ id: 'nvidia/nemotron-3-ultra-550b-a55b' })).toBe(true);
		expect(isNvidiaNimFreeModel({ id: 'nvidia/paid-model' })).toBe(false);
	});

	it('maps OpenCode Zen model IDs to their documented API formats', () => {
		expect(getOpenCodeZenModelFormat('big-pickle')).toBe('oa-compat');
		expect(getOpenCodeZenModelFormat('muse-spark-1.3-contributor-free')).toBe('openai');
		expect(getOpenCodeZenModelFormat('claude-sonnet-4-5')).toBe('anthropic');
		expect(getOpenCodeZenModelFormat('qwen3.8-flash')).toBe('anthropic');
		expect(getOpenCodeZenModelFormat('qwen3.8-max')).toBe('oa-compat');
		expect(getOpenCodeZenModelFormat('gemini-3.1-pro')).toBe('google');
		expect(getOpenCodeZenModelFormat('jev-1.13-free')).toBe('systemone');
		expect(getOpenCodeZenModelFormat('future-model-free')).toBe('unknown');
	});

});
