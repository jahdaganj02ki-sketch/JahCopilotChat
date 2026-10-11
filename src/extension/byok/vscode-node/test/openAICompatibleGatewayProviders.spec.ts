/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 JahCopilotChat contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
	CloudflareWorkersAILMProvider,
	GroqLMProvider,
	KILO_OPENAI_COMPATIBLE_PROVIDER_PRESETS,
	KiloOpenAICompatiblePresetLMProvider,
	ZenMuxLMProvider,
} from '../openAICompatibleGatewayProviders';

function jsonResponse(data: unknown, status = 200): { ok: boolean; status: number; statusText: string; json: () => Promise<unknown> } {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText: status === 200 ? 'OK' : 'Request Failed',
		json: async () => data,
	};
}

function createProvider<T>(
	Provider: new (...args: any[]) => T,
	fetch: ReturnType<typeof vi.fn>,
	...providerArguments: unknown[]
): T {
	const storage = {
		getAPIKey: vi.fn().mockResolvedValue(undefined),
		storeAPIKey: vi.fn().mockResolvedValue(undefined),
		deleteAPIKey: vi.fn().mockResolvedValue(undefined),
		getStoredModelConfigs: vi.fn().mockResolvedValue({}),
		saveModelConfig: vi.fn().mockResolvedValue(undefined),
		removeModelConfig: vi.fn().mockResolvedValue(undefined),
	};
	const logService = {
		_serviceBrand: undefined,
		trace: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		show: vi.fn(),
		createSubLogger: vi.fn(),
		withExtraTarget: vi.fn(),
	};
	logService.createSubLogger.mockReturnValue(logService);

	return new Provider(
		...providerArguments,
		storage as any,
		{ fetch } as any,
		logService as any,
		{ createInstance: vi.fn().mockReturnValue({}) } as any,
		{} as any,
		{} as any,
	);
}

async function discoverModels(provider: unknown, configuration: Record<string, unknown>, silent = false): Promise<any[]> {
	const token = new vscode.CancellationTokenSource().token;
	return (provider as any).provideLanguageModelChatInformation({ silent, configuration }, token);
}

describe('OpenAI-compatible gateway providers', () => {
	it('exposes unique Kilo Code-compatible provider presets without duplicating existing integrations', () => {
		const ids = KILO_OPENAI_COMPATIBLE_PROVIDER_PRESETS.map(preset => preset.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toContain('fireworks-ai');
		expect(ids).toContain('mixlayer');
		expect(ids).toContain('poolside');
		expect(ids).toContain('trustedrouter');
		expect(ids).toContain('vercel');
		expect(ids).not.toContain('groq');
		expect(ids).not.toContain('zenmux');
		expect(ids).not.toContain('openrouter');
	});

	it('discovers models through a named preset, honors a base URL override, and normalizes its trailing slash', async () => {
		const fetch = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'v0-1.0-md', context_length: 32768, max_output_tokens: 4096 }] }));
		const preset = KILO_OPENAI_COMPATIBLE_PROVIDER_PRESETS.find(item => item.id === 'v0')!;
		const provider = createProvider(KiloOpenAICompatiblePresetLMProvider, fetch, preset);

		const models = await discoverModels(provider, { apiKey: 'v0-test-key', url: 'https://gateway.example/v1/' });

		expect(fetch).toHaveBeenCalledOnce();
		expect(fetch.mock.calls[0][0]).toBe('https://gateway.example/v1/models');
		expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer v0-test-key');
		expect(models[0]).toMatchObject({
			id: 'v0-1.0-md',
			url: 'https://gateway.example/v1',
			maxInputTokens: 28672,
			maxOutputTokens: 4096,
		});
	});

	it('discovers local LM Studio models without requiring an API key during silent refresh', async () => {
		const fetch = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'qwen3-coder' }] }));
		const preset = KILO_OPENAI_COMPATIBLE_PROVIDER_PRESETS.find(item => item.id === 'lmstudio')!;
		const provider = createProvider(KiloOpenAICompatiblePresetLMProvider, fetch, preset);

		await expect(discoverModels(provider, {}, true)).resolves.toEqual([]);
		expect(fetch).not.toHaveBeenCalled();

		const models = await discoverModels(provider, { url: preset.baseUrl }, true);

		expect(fetch).toHaveBeenCalledOnce();
		expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:1234/v1/models');
		expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
		expect(models.map(model => model.id)).toEqual(['qwen3-coder']);
	});

	it('does not send silent model-discovery requests to keyed cloud providers until configured', async () => {
		const fetch = vi.fn();
		const preset = KILO_OPENAI_COMPATIBLE_PROVIDER_PRESETS.find(item => item.id === 'deepseek')!;
		const provider = createProvider(KiloOpenAICompatiblePresetLMProvider, fetch, preset);

		await expect(discoverModels(provider, {}, true)).resolves.toEqual([]);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('discovers Groq chat models and excludes speech transcription models', async () => {
		const fetch = vi.fn().mockResolvedValue(jsonResponse({
			data: [
				{
					id: 'llama-3.3-70b-versatile',
					context_window: 131072,
					max_completion_tokens: 32768,
				},
				{ id: 'whisper-large-v3-turbo', context_window: 448, max_completion_tokens: 448 },
			],
		}));
		const provider = createProvider(GroqLMProvider, fetch);

		const models = await discoverModels(provider, { apiKey: 'groq-test-key' });

		expect(fetch).toHaveBeenCalledOnce();
		expect(fetch.mock.calls[0][0]).toBe('https://api.groq.com/openai/v1/models');
		expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer groq-test-key');
		expect(models.map(model => model.id)).toEqual(['llama-3.3-70b-versatile']);
		expect(models[0]).toMatchObject({
			url: 'https://api.groq.com/openai/v1',
			maxInputTokens: 98304,
			maxOutputTokens: 32768,
			capabilities: { toolCalling: true },
		});
	});

	it('discovers ZenMux models from its official OpenAI-compatible model catalog', async () => {
		const fetch = vi.fn().mockResolvedValue(jsonResponse({
			data: [{
				id: 'google/gemini-2.5-pro',
				display_name: 'Gemini 2.5 Pro via ZenMux',
				context_length: 1_000_000,
				max_output_tokens: 65536,
				input_modalities: ['text', 'image'],
				capabilities: { reasoning: true, tool_calling: true },
			}, {
				id: 'provider/seedance-v1',
				display_name: 'Seedance Video Generation',
				input_modalities: ['text', 'image'],
				output_modalities: ['video'],
			}],
		}));
		const provider = createProvider(ZenMuxLMProvider, fetch);

		const models = await discoverModels(provider, { apiKey: 'zenmux-test-key' });

		expect(fetch).toHaveBeenCalledOnce();
		expect(fetch.mock.calls[0][0]).toBe('https://zenmux.ai/api/v1/models');
		expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer zenmux-test-key');
		expect(models).toHaveLength(1);
		expect(models[0]).toMatchObject({
			id: 'google/gemini-2.5-pro',
			name: 'Gemini 2.5 Pro via ZenMux',
			url: 'https://zenmux.ai/api/v1',
			maxInputTokens: 934464,
			maxOutputTokens: 65536,
			capabilities: { toolCalling: true, imageInput: true },
		});
	});

	it('discovers Cloudflare text-generation models with account-scoped inference URLs and paginates', async () => {
		const accountId = '0123456789abcdef0123456789abcdef';
		const authorizationHeaders: string[] = [];
		const fetch = vi.fn(async (requestUrl: string, options: { headers: Record<string, string> }) => {
			authorizationHeaders.push(options.headers.Authorization);
			const url = new URL(requestUrl);
			if (url.searchParams.get('page') === '1') {
				return jsonResponse({
					success: true,
					result: [
						{
							id: 123,
							name: '@cf/meta/llama-3.1-8b-instruct',
							display_name: 'Llama 3.1 8B Instruct',
							task: { name: 'Text Generation' },
							properties: [
								{ property: { name: 'context_length' }, value: 131072 },
								{ property: { name: 'max_output_tokens' }, value: 8192 },
							],
							supports_tools: true,
							input_modalities: ['text', 'image'],
						},
						{
							id: 124,
							name: '@cf/baai/bge-large-en-v1.5',
							task: { name: 'Text Embeddings' },
						},
					],
					result_info: { page: 1, per_page: 100, total_count: 101, total_pages: 2 },
				});
			}
			return jsonResponse({
				success: true,
				result: [{
					id: 125,
					name: '@cf/qwen/qwen1.5-14b-chat-awq',
					task: { name: 'Text Generation' },
				}],
				result_info: { page: 2, per_page: 100, total_count: 101, total_pages: 2 },
			});
		});
		const provider = createProvider(CloudflareWorkersAILMProvider, fetch);

		const models = await discoverModels(provider, { apiKey: 'cloudflare-test-token', accountId });

		expect(fetch).toHaveBeenCalledTimes(2);
		for (const [requestUrl] of fetch.mock.calls) {
			const url = new URL(requestUrl);
			expect(url.pathname).toBe(`/client/v4/accounts/${accountId}/ai/models/search`);
			expect(url.searchParams.get('task')).toBe('Text Generation');
			expect(url.searchParams.get('hide_experimental')).toBe('true');
		}
		expect(authorizationHeaders).toEqual(['Bearer cloudflare-test-token', 'Bearer cloudflare-test-token']);
		expect(new URL(fetch.mock.calls[1][0]).searchParams.get('page')).toBe('2');
		expect(models.map(model => model.id)).toEqual([
			'@cf/meta/llama-3.1-8b-instruct',
			'@cf/qwen/qwen1.5-14b-chat-awq',
		]);
		expect(models[0]).toMatchObject({
			name: 'Llama 3.1 8B Instruct',
			url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
			maxInputTokens: 122880,
			maxOutputTokens: 8192,
			capabilities: { toolCalling: true, imageInput: true },
		});
		expect(models[1].capabilities.toolCalling).toBe(false);
	});

	it('does not query Cloudflare when the account ID or token is missing or invalid', async () => {
		const fetch = vi.fn();
		const provider = createProvider(CloudflareWorkersAILMProvider, fetch);

		await expect(discoverModels(provider, { apiKey: 'cloudflare-test-token', accountId: 'not-an-account-id' })).resolves.toEqual([]);
		await expect(discoverModels(provider, { accountId: '0123456789abcdef0123456789abcdef' })).resolves.toEqual([]);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('surfaces failed Cloudflare catalog requests without exposing the API token', async () => {
		const fetch = vi.fn().mockResolvedValue(jsonResponse({ errors: [{ message: 'Unauthorized' }] }, 401));
		const provider = createProvider(CloudflareWorkersAILMProvider, fetch);

		await expect(discoverModels(provider, {
			apiKey: 'do-not-leak-this-token',
			accountId: '0123456789abcdef0123456789abcdef',
		})).rejects.toThrow('Cloudflare Workers AI model discovery failed (401 Request Failed).');
		expect(fetch.mock.calls[0][0]).not.toContain('do-not-leak-this-token');
	});
});
