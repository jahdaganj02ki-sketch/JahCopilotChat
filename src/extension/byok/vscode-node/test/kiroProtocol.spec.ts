/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 JahCopilotChat contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { buildKiroRequest, encodeKiroEventFrame, normalizeKiroModelCatalog, parseKiroEventFrame, readKiroEventStream } from '../kiroProtocol';

describe('Kiro protocol helpers', () => {
	it('normalizes a dynamic model catalog and ignores malformed or duplicate entries', () => {
		const models = normalizeKiroModelCatalog({
			models: [
				{ modelId: 'claude-sonnet', modelName: 'Claude Sonnet', tokenLimits: { maxInputTokens: 200_000, maxOutputTokens: 16_000 }, inputModalities: ['TEXT', 'IMAGE'] },
				{ modelId: 'claude-sonnet', modelName: 'Duplicate' },
				{ modelId: 'claude-haiku', displayName: 'Claude Haiku', contextLength: 100_000, rateMultiplier: '1.4' },
				{ modelId: '  ' },
				null,
			],
		});

		expect(models).toEqual([
			{ id: 'claude-sonnet', name: 'Claude Sonnet', maxInputTokens: 200_000, maxOutputTokens: 16_000, imageInput: true },
			{ id: 'claude-haiku', name: 'Claude Haiku', maxInputTokens: 100_000, maxOutputTokens: 8_192, imageInput: false, rateMultiplier: 1.4 },
		]);
	});

	it('converts system instructions, history, tool results, and tool definitions', () => {
		const request = buildKiroRequest('claude-sonnet', [
			{ role: 3, content: [{ value: 'Follow the project conventions.' }] },
			{ role: 1, content: [{ value: 'Read the file.' }] },
			{ role: 2, content: [
				{ value: 'I will inspect it.' },
				{ callId: 'call-1', name: 'read_file', input: { path: 'README.md' } },
			] },
			{ role: 1, content: [
				{ callId: 'call-1', content: [{ value: 'File contents.' }] },
			] },
		], [{
			name: 'read_file',
			description: 'Read a workspace file',
			inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
		}], { conversationId: 'conversation-1', maxTokens: 64_000, temperature: 0.4, requireTool: true });

		const state = request.conversationState as {
			history: Array<Record<string, any>>;
			currentMessage: { userInputMessage: Record<string, any> };
		};
		expect(state.history).toHaveLength(2);
		expect(state.history[0].userInputMessage.content).toBe('Read the file.');
		expect(state.history[1].assistantResponseMessage.toolUses).toEqual([
			{ toolUseId: 'call-1', name: 'read_file', input: { path: 'README.md' } },
		]);
		expect(state.currentMessage.userInputMessage.content).toContain('<instructions>');
		expect(state.currentMessage.userInputMessage.content).toContain('caller requires a tool call');
		expect(state.currentMessage.userInputMessage.userInputMessageContext).toMatchObject({
			toolResults: [{ toolUseId: 'call-1', status: 'success', content: [{ text: 'File contents.' }] }],
			tools: [{ toolSpecification: { name: 'read_file' } }],
		});
		expect(request.inferenceConfig).toEqual({ maxTokens: 32_000, temperature: 0.4 });
	});

	it('parses valid AWS EventStream framing and rejects a corrupted checksum', () => {
		const frame = encodeKiroEventFrame({ ':message-type': 'event', ':event-type': 'assistantResponseEvent' }, { content: 'Hello' });
		expect(parseKiroEventFrame(frame)).toEqual({
			headers: { ':message-type': 'event', ':event-type': 'assistantResponseEvent' },
			payload: { content: 'Hello' },
		});

		const corrupted = frame.slice();
		corrupted[corrupted.length - 1] ^= 0xff;
		expect(() => parseKiroEventFrame(corrupted)).toThrow('message checksum');
	});

	it('decodes frames split across arbitrary network chunks', async () => {
		const first = encodeKiroEventFrame({ ':event-type': 'assistantResponseEvent' }, { content: 'A' });
		const second = encodeKiroEventFrame({ ':event-type': 'messageStopEvent' }, {});
		const all = new Uint8Array(first.length + second.length);
		all.set(first);
		all.set(second, first.length);
		const chunks: AsyncIterable<Uint8Array> = {
			async *[Symbol.asyncIterator]() {
				yield all.slice(0, 5);
				yield all.slice(5, first.length + 7);
				yield all.slice(first.length + 7);
			},
		};

		const events = [];
		for await (const event of readKiroEventStream(chunks)) {
			events.push(event);
		}
		expect(events.map(event => event.headers[':event-type'])).toEqual(['assistantResponseEvent', 'messageStopEvent']);
		expect(events[0].payload).toEqual({ content: 'A' });
	});
});
