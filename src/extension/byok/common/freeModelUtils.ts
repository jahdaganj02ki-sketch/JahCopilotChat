/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 JahCopilotChat contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Returns a record for provider catalog entries without trusting their shape.
 */
export function asModelRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

/**
 * Extracts the model identifier used in OpenAI-compatible requests from common
 * model-catalog response formats.
 */
export function getModelId(value: unknown): string | undefined {
	const model = asModelRecord(value);
	if (!model) {
		return undefined;
	}

	for (const key of ['id', 'model', 'model_id', 'modelId', 'slug']) {
		const candidate = model[key];
		if (typeof candidate === 'string' && candidate.trim()) {
			return candidate.trim();
		}
	}
	return undefined;
}

function hasFreeLabel(value: unknown): boolean {
	if (typeof value === 'string') {
		return /\bfree(?:\s+endpoint)?\b|\bno[- ]cost\b|\bcomplimentary\b/i.test(value);
	}
	if (Array.isArray(value)) {
		return value.some(hasFreeLabel);
	}
	return false;
}

function isExplicitFreeFlag(value: unknown): boolean {
	if (value === true) {
		return true;
	}
	return typeof value === 'string' && /^(?:true|free|zero[- ]cost|no[- ]cost)$/i.test(value.trim());
}

function parsePrice(value: unknown): number | undefined {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : undefined;
	}
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value.trim().replace(/^\$/, ''));
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	const record = asModelRecord(value);
	if (!record) {
		return undefined;
	}
	for (const key of ['value', 'amount', 'price', 'perToken', 'per_token', 'perMillionTokens', 'per1mTokens']) {
		const parsed = parsePrice(record[key]);
		if (parsed !== undefined) {
			return parsed;
		}
	}
	return undefined;
}

function readPrice(source: Record<string, unknown>, keys: readonly string[]): number | undefined {
	for (const key of keys) {
		const parsed = parsePrice(source[key]);
		if (parsed !== undefined) {
			return parsed;
		}
	}
	return undefined;
}

/**
 * Identifies free models only when a catalog provides an explicit free marker,
 * a zero price for both input and output, or a conventional `:free`/`-free` ID.
 * It deliberately does not infer that an unpriced model is free.
 */
export function isExplicitlyFreeModel(value: unknown): boolean {
	const model = asModelRecord(value);
	if (!model) {
		return false;
	}

	for (const key of ['free', 'is_free', 'isFree', 'free_endpoint', 'freeEndpoint', 'is_free_endpoint']) {
		if (isExplicitFreeFlag(model[key])) {
			return true;
		}
	}

	const modelId = getModelId(model);
	if (modelId && /(?:^|[/:_-])free(?:$|[/:_-])/i.test(modelId)) {
		return true;
	}

	const descriptiveFields = [model.name, model.description, model.badge, model.badges, model.status, model.tier, model.tags, model.labels];
	if (descriptiveFields.some(hasFreeLabel)) {
		return true;
	}

	const pricing = asModelRecord(model.pricing) ?? asModelRecord(model.cost) ?? asModelRecord(model.prices);
	const sources = pricing ? [pricing, model] : [model];
	const inputPriceKeys = ['prompt', 'input', 'input_price', 'prompt_price', 'inputPrice', 'promptPrice', 'input_cost', 'prompt_cost'];
	const outputPriceKeys = ['completion', 'output', 'output_price', 'completion_price', 'outputPrice', 'completionPrice', 'output_cost', 'completion_cost'];

	let inputPrice: number | undefined;
	let outputPrice: number | undefined;
	for (const source of sources) {
		inputPrice ??= readPrice(source, inputPriceKeys);
		outputPrice ??= readPrice(source, outputPriceKeys);
	}

	return inputPrice === 0 && outputPrice === 0;
}

/** The OpenCode Zen free catalog includes this free model without a `-free` suffix. */
export function isOpenCodeZenFreeModel(value: unknown): boolean {
	const id = getModelId(value)?.toLowerCase();
	return isExplicitlyFreeModel(value) || id === 'big-pickle' || id?.endsWith('/big-pickle') === true;
}

export type OpenCodeZenModelFormat = 'oa-compat' | 'openai' | 'anthropic' | 'google' | 'systemone' | 'unknown';

/**
 * Resolves the API format used by an OpenCode Zen model. The Zen `/models`
 * endpoint returns IDs without format metadata, so keep this aligned with the
 * model/endpoint table in https://opencode.ai/docs/zen/.
 */
export function getOpenCodeZenModelFormat(modelId: string): OpenCodeZenModelFormat {
	const id = modelId.trim().toLowerCase();

	if (/^(?:gpt|grok|muse-spark)-/.test(id)) {
		return 'openai';
	}
	if (/^claude-/.test(id) || /^qwen3\.(?:8-flash|7-(?:max|plus)|6-plus|5-plus)(?:-|$)/.test(id)) {
		return 'anthropic';
	}
	if (/^gemini-/.test(id)) {
		return 'google';
	}
	if (/^jev-/.test(id)) {
		return 'systemone';
	}
	if (/^(?:qwen3\.8-max(?:-|$)|deepseek-|minimax-|glm-|kimi-|mistral-|big-pickle$|space-bunny-|longcat-|step-|exo-|mimo-|ling-|nemotron-)/.test(id)) {
		return 'oa-compat';
	}
	return 'unknown';
}

/** NVIDIA's public `/v1/models` response omits prices; keep this list aligned with its Free Endpoint catalog. */
const nvidiaNimFreeModelIds = new Set([
	'deepseek-ai/deepseek-v4.1-flash',
	'nvidia/nemotron-3.5-lightning-30b-a3b',
	'nvidia/nemotron-3-ultra-550b-a55b',
	'nvidia/nemotron-3-super-120b-a12b',
	'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
	'nvidia/nemotron-3.5-content-safety',
	'nvidia/llama-3.3-nemotron-super-49b-v1.5',
	'nvidia/llama-3.1-nemotron-ultra-253b-v1',
	'z-ai/glm-5-3',
	'z-ai/glm-5-3-flash',
	'meta/llama-3.1-70b-instruct',
	'meta/llama-3.2-3b-instruct',
	'meta/llama-3.2-11b-vision-instruct',
	'qwen/qwen3.5-397b-a17b',
	'qwen/qwen3.5-122b-a10b',
	'stepfun-ai/step-3.5-flash',
	'minimaxai/minimax-m2.7',
]);

export function isNvidiaNimFreeModel(value: unknown): boolean {
	const id = getModelId(value)?.toLowerCase();
	return isExplicitlyFreeModel(value) || (!!id && nvidiaNimFreeModelIds.has(id));
}

/** Kilo's gateway documents this free auto-router even when it is omitted from `/models`. */
export function isKiloGatewayFreeModel(value: unknown): boolean {
	const id = getModelId(value)?.toLowerCase();
	return isExplicitlyFreeModel(value) || id === 'kilo-auto/free';
}

export function isOpenRouterFreeModel(value: unknown): boolean {
	return isExplicitlyFreeModel(value);
}
