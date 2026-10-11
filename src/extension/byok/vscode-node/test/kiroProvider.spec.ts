/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 JahCopilotChat contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { KiroLMProvider } from '../kiroProvider';
import { encodeKiroEventFrame } from '../kiroProtocol';

describe('KiroLMProvider', () => {
	function createProvider(fetch: ReturnType<typeof vi.fn>) {
		const logService = { error: vi.fn() };
		const storage = {
			getAPIKey: vi.fn().mockResolvedValue(undefined),
			deleteAPIKey: vi.fn().mockResolvedValue(undefined),
		};
		const fetcher = {
			fetch,
			makeAbortController: vi.fn(() => new AbortController()),
			isAbortError: vi.fn(() => false),
		};
		return { provider: new KiroLMProvider(storage as any, fetcher as any, logService as any), fetcher };
	}

	it('discovers account-specific models from the selected AWS region with API-key auth', async () => {
		const fetch = vi.fn(async () => ({
			ok: true,
			json: async () => ({ models: [{ modelId: 'claude-sonnet', modelName: 'Claude Sonnet', tokenLimits: { maxInputTokens: 180_000, maxOutputTokens: 12_000 } }] }),
		}));
		const { provider } = createProvider(fetch);
		const tokenSource = new vscode.CancellationTokenSource();

		const models = await provider.provideLanguageModelChatInformation({
			silent: false,
			configuration: { apiKey: 'kiro-test-key', region: 'eu-central-1' },
		} as any, tokenSource.token);

		expect(fetch).toHaveBeenCalledWith(
			'https://q.eu-central-1.amazonaws.com/ListAvailableModels?origin=AI_EDITOR',
			expect.objectContaining({
				method: 'GET',
				headers: expect.objectContaining({
					Authorization: 'Bearer kiro-test-key',
					TokenType: 'API_KEY',
					Accept: 'application/json',
				}),
			}),
		);
		expect(models).toMatchObject([{
			id: 'claude-sonnet',
			name: 'Claude Sonnet',
			maxInputTokens: 180_000,
			maxOutputTokens: 12_000,
			configuration: { apiKey: 'kiro-test-key', region: 'eu-central-1' },
		}]);
		tokenSource.dispose();
	});

	it('rejects an invalid region before constructing a request host', async () => {
		const fetch = vi.fn();
		const { provider } = createProvider(fetch);
		const tokenSource = new vscode.CancellationTokenSource();
		await expect(provider.provideLanguageModelChatInformation({
			silent: false,
			configuration: { apiKey: 'kiro-test-key', region: 'example.com' },
		} as any, tokenSource.token)).rejects.toThrow('Invalid AWS region');
		expect(fetch).not.toHaveBeenCalled();
		tokenSource.dispose();
	});

	it('streams Kiro EventStream text, reasoning, and tool-use events', async () => {
		const textFrame = encodeKiroEventFrame({ ':message-type': 'event', ':event-type': 'assistantResponseEvent' }, { content: 'Here is <think' });
		const textContinuationFrame = encodeKiroEventFrame({ ':message-type': 'event', ':event-type': 'assistantResponseEvent' }, { content: 'ing>my chain</thinking> the result.' });
		const thinkingFrame = encodeKiroEventFrame({ ':message-type': 'event', ':event-type': 'reasoningContentEvent' }, { reasoningContentEvent: { text: 'Check the file first.' } });
		const toolFrame = encodeKiroEventFrame({ ':message-type': 'event', ':event-type': 'toolUseEvent' }, [{ toolUseId: 'tool-1', name: 'read_file', input: { path: 'README.md' } }]);
		const frames = [textFrame, textContinuationFrame, thinkingFrame, toolFrame];
		const fetch = vi.fn(async (_url: string, _options: { body?: string; headers?: Record<string, string> }) => ({
			ok: true,
			body: {
				async *[Symbol.asyncIterator]() {
					for (const frame of frames) {
						yield frame;
					}
				},
			},
		}));
		const { provider } = createProvider(fetch);
		const tokenSource = new vscode.CancellationTokenSource();
		const reported: unknown[] = [];
		const model = {
			id: 'claude-sonnet',
			maxOutputTokens: 8_192,
			configuration: { apiKey: 'kiro-test-key', region: 'us-east-1' },
		} as any;

		await provider.provideLanguageModelChatResponse(model, [{ role: 1, content: [{ value: 'Summarize the file.' }] }] as any, {
			tools: [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }],
			toolMode: 1,
		} as any, { report: (part: unknown) => reported.push(part) } as any, tokenSource.token);

		const requestCall = fetch.mock.calls[0];
		if (!requestCall) {
			throw new Error('Expected the Kiro chat request to be sent');
		}
		const [requestUrl, requestOptions] = requestCall;
		const request = JSON.parse(requestOptions.body ?? '{}');
		expect(requestUrl).toBe('https://q.us-east-1.amazonaws.com/generateAssistantResponse?origin=AI_EDITOR');
		expect(requestOptions.headers).toMatchObject({
			Authorization: 'Bearer kiro-test-key',
			TokenType: 'API_KEY',
			'Content-Type': 'application/json',
			Accept: 'application/vnd.amazon.eventstream',
			'x-amzn-kiro-agent-mode': 'spec',
		});
		expect(request.conversationState.currentMessage.userInputMessage).toMatchObject({
			content: 'Summarize the file.',
			modelId: 'claude-sonnet',
			origin: 'AI_EDITOR',
		});
		expect(reported.map((part: any) => part.value ?? part.name)).toEqual([
			'Here is ',
			'my chain',
			' the result.',
			'Check the file first.',
			'read_file',
		]);
		expect(reported[4]).toMatchObject({ callId: 'tool-1', input: { path: 'README.md' } });
		tokenSource.dispose();
	});
});
