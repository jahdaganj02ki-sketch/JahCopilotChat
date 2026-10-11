/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 JahCopilotChat contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ModelSupportedEndpoint } from '../../../../platform/endpoint/common/endpointProvider';
import { OpenAIEndpoint } from '../../node/openAIEndpoint';
import { OpenCodeZenLMProvider } from '../freeModelGatewayProviders';

function createJsonResponse(data: unknown) {
	return {
		ok: true,
		status: 200,
		statusText: 'OK',
		json: async () => data,
	};
}

function createOpenCodeZenProvider(fetch: ReturnType<typeof vi.fn>) {
	const storage = {
		getAPIKey: vi.fn().mockResolvedValue(undefined),
		deleteAPIKey: vi.fn().mockResolvedValue(undefined),
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
	const instantiationService = { createInstance: vi.fn().mockReturnValue({}) };
	const provider = new OpenCodeZenLMProvider(
		storage as any,
		{ fetch } as any,
		logService as any,
		instantiationService as any,
		{} as any,
		{} as any,
	);
	return { provider, instantiationService };
}

describe('OpenCode Zen model routing', () => {
	it('routes free Responses models correctly and only advertises formats supported by this chat provider', async () => {
		const fetch = vi.fn().mockResolvedValue(createJsonResponse({
			data: [
				{ id: 'big-pickle' },
				{ id: 'muse-spark-1.3-contributor-free' },
				{ id: 'jev-1.13-free' },
				{ id: 'claude-sonnet-4-5-free' },
				{ id: 'gemini-3.1-pro-free' },
				{ id: 'future-model-free' },
			],
		}));
		const { provider, instantiationService } = createOpenCodeZenProvider(fetch);
		const tokenSource = new vscode.CancellationTokenSource();
		const models = await provider.provideLanguageModelChatInformation({
			silent: false,
			configuration: { apiKey: 'zen-test-key' },
		}, tokenSource.token);

		expect(fetch).toHaveBeenCalledWith(
			'https://opencode.ai/zen/v1/models',
			expect.objectContaining({
				method: 'GET',
				headers: expect.objectContaining({ Authorization: 'Bearer zen-test-key' }),
			}),
		);
		expect(models.map(model => model.id)).toEqual(['big-pickle', 'muse-spark-1.3-contributor-free']);
		instantiationService.createInstance.mockClear();

		const responsesModel = models.find(model => model.id === 'muse-spark-1.3-contributor-free')!;
		await (provider as any).createOpenAIEndPoint(responsesModel);
		const responsesEndpointCall = instantiationService.createInstance.mock.calls[0];
		expect(responsesEndpointCall[0]).toBe(OpenAIEndpoint);
		expect(responsesEndpointCall[1].supported_endpoints).toEqual([ModelSupportedEndpoint.Responses]);
		expect(responsesEndpointCall[2]).toBe('zen-test-key');
		expect(responsesEndpointCall[3]).toBe('https://opencode.ai/zen/v1/responses');

		const chatModel = models.find(model => model.id === 'big-pickle')!;
		await (provider as any).createOpenAIEndPoint(chatModel);
		const chatEndpointCall = instantiationService.createInstance.mock.calls[1];
		expect(chatEndpointCall[1].supported_endpoints).toEqual([ModelSupportedEndpoint.ChatCompletions]);
		expect(chatEndpointCall[3]).toBe('https://opencode.ai/zen/v1/chat/completions');

		tokenSource.dispose();
	});
});
