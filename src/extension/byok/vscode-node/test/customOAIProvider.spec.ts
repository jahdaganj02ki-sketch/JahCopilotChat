/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 JahCopilotChat contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { CustomOAIBYOKModelProvider, resolveCustomOAIBaseUrl, resolveCustomOAIUrl } from '../customOAIProvider';

function createProvider(fetch: ReturnType<typeof vi.fn>): CustomOAIBYOKModelProvider {
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
	const extensionContext = {
		globalState: {
			get: vi.fn().mockReturnValue(true),
			update: vi.fn().mockResolvedValue(undefined),
		},
	};

	return new CustomOAIBYOKModelProvider(
		storage as any,
		logService as any,
		{ fetch } as any,
		{ createInstance: vi.fn().mockReturnValue({}) } as any,
		{} as any,
		{} as any,
		extensionContext as any,
	);
}

describe('CustomOAIBYOKModelProvider', () => {
	it('normalizes OpenAI-compatible base URLs and leaves explicit endpoints untouched', () => {
		expect(resolveCustomOAIBaseUrl('https://api.example.com')).toBe('https://api.example.com/v1');
		expect(resolveCustomOAIBaseUrl('https://api.example.com/v2/')).toBe('https://api.example.com/v2');
		expect(resolveCustomOAIBaseUrl('https://api.example.com/v1/chat/completions')).toBe('https://api.example.com/v1');
		expect(resolveCustomOAIUrl('model', 'https://api.example.com')).toBe('https://api.example.com/v1/chat/completions');
		expect(resolveCustomOAIUrl('model', 'https://api.example.com/v1/chat/completions')).toBe('https://api.example.com/v1/chat/completions');
		expect(resolveCustomOAIUrl('model', 'https://api.example.com/v1/responses')).toBe('https://api.example.com/v1/responses');
	});

	it('discovers models from a custom base URL and resolves chat capabilities', async () => {
		const fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({
				data: [
					{
						id: 'local-code-model',
						name: 'Local Code Model',
						context_window: 32768,
						max_completion_tokens: 4096,
						supported_parameters: ['tools'],
						input_modalities: ['text'],
					},
					{ id: 'whisper-large-v3', name: 'Whisper Large v3' },
				],
			}),
		});
		const provider = createProvider(fetch);
		const token = new vscode.CancellationTokenSource().token;

		const models = await provider.provideLanguageModelChatInformation({
			silent: false,
			configuration: { url: 'https://api.example.com', apiKey: 'custom-test-key' },
		}, token);

		expect(fetch).toHaveBeenCalledOnce();
		expect(fetch.mock.calls[0][0]).toBe('https://api.example.com/v1/models');
		expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer custom-test-key');
		expect(models).toHaveLength(1);
		expect(models[0]).toMatchObject({
			id: 'local-code-model',
			name: 'Local Code Model',
			url: 'https://api.example.com/v1',
			maxInputTokens: 28672,
			maxOutputTokens: 4096,
			capabilities: { toolCalling: true },
		});
	});
});
