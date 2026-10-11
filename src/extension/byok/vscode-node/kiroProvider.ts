/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 JahCopilotChat contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import * as os from 'os';
import { CancellationToken, LanguageModelChatMessage, LanguageModelChatMessage2, LanguageModelChatToolMode, LanguageModelResponsePart2, LanguageModelTextPart, LanguageModelThinkingPart, LanguageModelToolCallPart, Progress, ProvideLanguageModelChatResponseOptions } from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import { AbstractLanguageModelChatProvider, ExtendedLanguageModelChatInformation, LanguageModelChatConfiguration } from './abstractLanguageModelChatProvider';
import { IBYOKStorageService } from './byokStorageService';
import { buildKiroRequest, KiroChatMessage, KiroChatTool, normalizeKiroModelCatalog, readKiroEventStream } from './kiroProtocol';

const KIRO_ORIGIN = 'AI_EDITOR';
const DEFAULT_REGION = 'us-east-1';
const KIRO_RUNTIME_SDK_VERSION = '1.0.0';
const KIRO_CLIENT_VERSION = '0.10.32';
const KIRO_MACHINE_ID = createHash('sha256').update(generateUuid()).digest('hex');
const KIRO_RISK_NOTICE = 'Experimental, unofficial Kiro runtime integration adapted from 9Router. Kiro documents API keys for its headless CLI, not a general public chat API. Use at your own risk.';

function createKiroHeaders(apiKey: string, accept: string, agentMode: 'spec' | 'vibe', contentType?: string): Record<string, string> {
	const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
	const clientTag = `KiroIDE-${KIRO_CLIENT_VERSION}-${KIRO_MACHINE_ID}`;
	return {
		Authorization: `Bearer ${apiKey}`,
		TokenType: 'API_KEY',
		Accept: accept,
		...(contentType ? { 'Content-Type': contentType } : {}),
		'User-Agent': `aws-sdk-js/${KIRO_RUNTIME_SDK_VERSION} ua/2.1 os/${platform}#${os.release()} lang/js md/nodejs#${process.versions.node} api/codewhispererruntime#${KIRO_RUNTIME_SDK_VERSION} m/N,E ${clientTag}`,
		'X-Amz-User-Agent': `aws-sdk-js/${KIRO_RUNTIME_SDK_VERSION} ${clientTag}`,
		'x-amzn-kiro-agent-mode': agentMode,
		'x-amzn-codewhisperer-machine-id': 'kiro-desktop',
		'x-amzn-codewhisperer-optout': 'true',
		'Amz-Sdk-Request': 'attempt=1; max=3',
		'Amz-Sdk-Invocation-Id': generateUuid(),
	};
}

interface KiroConfiguration extends LanguageModelChatConfiguration {
	readonly region?: string;
}

interface KiroLanguageModelChatInformation extends ExtendedLanguageModelChatInformation<KiroConfiguration> { }

interface KiroToolUseBuffer {
	readonly callId: string;
	readonly name: string;
	inputText: string;
	inputValue?: object;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function normalizeRegion(region: string | undefined): string {
	const normalized = region?.trim() || DEFAULT_REGION;
	// Region is inserted into the request hostname. Restrict it to AWS-style region names.
	if (!/^[a-z]{2}(?:-[a-z]+){1,2}-\d$/.test(normalized)) {
		throw new Error(`Invalid AWS region "${normalized}". Use a region such as us-east-1 or eu-central-1.`);
	}
	return normalized;
}

function getErrorMessage(payload: unknown, apiKey: string): string {
	const record = asRecord(payload);
	let raw = 'Unknown error';
	if (typeof record?.message === 'string') {
		raw = record.message;
	} else if (typeof record?.Message === 'string') {
		raw = record.Message;
	} else if (typeof record?.__type === 'string') {
		raw = record.__type;
	} else if (typeof payload === 'string') {
		raw = payload;
	}
	return raw.replaceAll(apiKey, '[redacted]').slice(0, 2_000);
}

function textContentFromEvent(payload: unknown): string | undefined {
	const record = asRecord(payload);
	const nested = asRecord(record?.reasoningContentEvent);
	if (typeof record?.content === 'string') {
		return record.content;
	}
	if (typeof record?.text === 'string') {
		return record.text;
	}
	if (typeof record?.reasoningContentEvent === 'string') {
		return record.reasoningContentEvent;
	}
	if (typeof nested?.text === 'string') {
		return nested.text;
	}
	if (typeof nested?.content === 'string') {
		return nested.content;
	}
	return undefined;
}

function parseToolInput(value: unknown): object | undefined {
	if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
		return value;
	}
	if (typeof value === 'string' && value.trim()) {
		try {
			const parsed: unknown = JSON.parse(value);
			return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
		} catch {
			return undefined;
		}
	}
	return undefined;
}

interface KiroInlineThinkingState {
	inThinking: boolean;
	pending: string;
}

function partialMarkerSuffixLength(value: string, marker: string): number {
	for (let length = Math.min(value.length, marker.length - 1); length > 0; length--) {
		if (marker.startsWith(value.slice(-length))) {
			return length;
		}
	}
	return 0;
}

function reportAssistantContent(content: string, state: KiroInlineThinkingState, progress: Progress<LanguageModelResponsePart2>): void {
	let remaining = state.pending + content;
	state.pending = '';
	while (remaining.length > 0) {
		const marker = state.inThinking ? '</thinking>' : '<thinking>';
		const markerIndex = remaining.indexOf(marker);
		if (markerIndex < 0) {
			const pendingLength = partialMarkerSuffixLength(remaining, marker);
			const completeLength = remaining.length - pendingLength;
			const completeContent = remaining.slice(0, completeLength);
			if (completeContent) {
				progress.report(state.inThinking ? new LanguageModelThinkingPart(completeContent) : new LanguageModelTextPart(completeContent));
			}
			state.pending = remaining.slice(completeLength);
			return;
		}
		const beforeMarker = remaining.slice(0, markerIndex);
		if (beforeMarker) {
			progress.report(state.inThinking ? new LanguageModelThinkingPart(beforeMarker) : new LanguageModelTextPart(beforeMarker));
		}
		remaining = remaining.slice(markerIndex + marker.length);
		state.inThinking = !state.inThinking;
	}
}

function flushAssistantContent(state: KiroInlineThinkingState, progress: Progress<LanguageModelResponsePart2>): void {
	if (state.pending) {
		progress.report(state.inThinking ? new LanguageModelThinkingPart(state.pending) : new LanguageModelTextPart(state.pending));
		state.pending = '';
	}
}

export class KiroLMProvider extends AbstractLanguageModelChatProvider<KiroConfiguration, KiroLanguageModelChatInformation> {
	public static readonly providerId = 'kiro';
	public static readonly providerName = 'Kiro AI (Experimental)';

	constructor(
		byokStorageService: IBYOKStorageService,
		@IFetcherService private readonly _fetcherService: IFetcherService,
		@ILogService logService: ILogService,
	) {
		super(KiroLMProvider.providerId, KiroLMProvider.providerName, undefined, byokStorageService, logService);
	}

	protected async getAllModels(silent: boolean, apiKey: string | undefined, configuration: KiroConfiguration | undefined): Promise<KiroLanguageModelChatInformation[]> {
		if (!apiKey) {
			return [];
		}

		const region = normalizeRegion(configuration?.region);
		const url = `https://q.${region}.amazonaws.com/ListAvailableModels?origin=${KIRO_ORIGIN}`;
		try {
			const response = await this._fetcherService.fetch(url, {
				method: 'GET',
				callSite: 'kiro-models-discovery',
				expectJSON: true,
				headers: createKiroHeaders(apiKey, 'application/json', 'vibe'),
			});
			if (!response.ok) {
				const body = await response.text();
				if (response.status === 401 || response.status === 403) {
					throw new Error('Kiro rejected the API key. Check that it is active and your account has an eligible Kiro plan.');
				}
				throw new Error(`Kiro model discovery failed (HTTP ${response.status}): ${getErrorMessage(body, apiKey)}`);
			}
			const catalog: unknown = await response.json();
			const catalogRecord = asRecord(catalog);
			if (!Array.isArray(catalogRecord?.models) && !Array.isArray(asRecord(catalogRecord?.data)?.models)) {
				throw new Error('Kiro returned an invalid model catalog response.');
			}
			const entries = normalizeKiroModelCatalog(catalog);
			return entries.map(entry => ({
				id: entry.id,
				name: entry.name,
				family: entry.id,
				version: '1.0.0',
				maxInputTokens: entry.maxInputTokens,
				maxOutputTokens: entry.maxOutputTokens,
				detail: KIRO_RISK_NOTICE,
				tooltip: KIRO_RISK_NOTICE,
				capabilities: {
					toolCalling: true,
					imageInput: entry.imageInput,
				},
				...(entry.rateMultiplier && entry.rateMultiplier !== 1 ? {
					multiplier: `${entry.rateMultiplier}x`,
					multiplierNumeric: entry.rateMultiplier,
				} : {}),
			}));
		} catch (error) {
			if (!silent || !this._fetcherService.isAbortError(error)) {
				this._logService.error(error, `Error fetching available ${KiroLMProvider.providerName} models`);
			}
			throw error;
		}
	}

	async provideLanguageModelChatResponse(
		model: KiroLanguageModelChatInformation,
		messages: Array<LanguageModelChatMessage | LanguageModelChatMessage2>,
		options: ProvideLanguageModelChatResponseOptions,
		progress: Progress<LanguageModelResponsePart2>,
		token: CancellationToken,
	): Promise<void> {
		const apiKey = model.configuration?.apiKey;
		if (!apiKey) {
			throw new Error('Kiro API key is not configured. Add it in the Kiro AI provider settings.');
		}
		const region = normalizeRegion(model.configuration?.region);
		const request = buildKiroRequest(
			model.id,
			messages as unknown as KiroChatMessage[],
			(options.tools ?? []) as unknown as KiroChatTool[],
			{
				conversationId: generateUuid(),
				maxTokens: model.maxOutputTokens,
				temperature: options.modelOptions?.temperature,
				requireTool: options.toolMode === LanguageModelChatToolMode.Required,
			},
		);
		const controller = this._fetcherService.makeAbortController();
		const cancellation = token.onCancellationRequested(() => controller.abort());
		const url = `https://q.${region}.amazonaws.com/generateAssistantResponse?origin=${KIRO_ORIGIN}`;
		const toolUses = new Map<string, KiroToolUseBuffer>();
		const inlineThinkingState: KiroInlineThinkingState = { inThinking: false, pending: '' };
		let receivedResponseContent = false;

		try {
			const response = await this._fetcherService.fetch(url, {
				method: 'POST',
				callSite: 'kiro-chat-completion',
				body: JSON.stringify(request),
				timeout: 300_000,
				signal: controller.signal,
				headers: createKiroHeaders(apiKey, 'application/vnd.amazon.eventstream', 'spec', 'application/json'),
			});
			if (!response.ok) {
				const body = await response.text();
				if (response.status === 401 || response.status === 403) {
					throw new Error('Kiro rejected the API key. Check that it is active and your account has an eligible Kiro plan.');
				}
				throw new Error(`Kiro request failed (HTTP ${response.status}): ${getErrorMessage(body, apiKey)}`);
			}

			for await (const event of readKiroEventStream(response.body)) {
				const eventType = String(event.headers[':event-type'] ?? '');
				const messageType = String(event.headers[':message-type'] ?? '');
				const payload = asRecord(event.payload);
				if (messageType === 'error' || messageType === 'exception' || /error|exception/i.test(eventType)) {
					throw new Error(`Kiro returned an error: ${getErrorMessage(event.payload, apiKey)}`);
				}

				if (eventType === 'assistantResponseEvent') {
					const text = textContentFromEvent(event.payload);
					if (text) {
						receivedResponseContent = true;
						reportAssistantContent(text, inlineThinkingState, progress);
					}
				} else if (eventType === 'codeEvent') {
					const text = textContentFromEvent(event.payload);
					if (text) {
						receivedResponseContent = true;
						progress.report(new LanguageModelTextPart(text));
					}
				} else if (eventType === 'reasoningContentEvent' || eventType === 'thinkingEvent') {
					const thinking = textContentFromEvent(event.payload);
					if (thinking) {
						receivedResponseContent = true;
						progress.report(new LanguageModelThinkingPart(thinking));
					}
				} else if (eventType === 'toolUseEvent') {
					const toolPayload = payload?.toolUseEvent ?? payload;
					const toolEvents = Array.isArray(event.payload) ? event.payload : Array.isArray(toolPayload) ? toolPayload : [toolPayload];
					if (toolEvents.length === 0) {
						throw new Error('Kiro returned an empty tool-use event.');
					}
					for (const candidate of toolEvents) {
						const toolEvent = asRecord(candidate);
						if (!toolEvent) {
							continue;
						}
						const rawCallId = toolEvent.toolUseId ?? toolEvent.toolUseID ?? toolEvent.id;
						const callId = typeof rawCallId === 'string' && rawCallId.trim() ? rawCallId : `call_${generateUuid()}`;
						const name = typeof toolEvent.name === 'string' ? toolEvent.name.trim()
							: typeof toolEvent.toolName === 'string' ? toolEvent.toolName.trim() : undefined;
						if (!name) {
							throw new Error('Kiro returned a tool-use event without a tool name.');
						}
						receivedResponseContent = true;
						const existingUse = toolUses.get(callId);
						if (existingUse && existingUse.name !== name) {
							throw new Error('Kiro changed the tool name between fragments of one tool call.');
						}
						const use = existingUse ?? { callId, name, inputText: '' };
						const input = toolEvent.input ?? toolEvent.arguments;
						if (typeof input === 'string') {
							use.inputText += input;
						} else {
							const parsed = parseToolInput(input);
							if (parsed) {
								use.inputValue = parsed;
							}
						}
						toolUses.set(callId, use);
					}
				}
			}
			flushAssistantContent(inlineThinkingState, progress);
			if (!receivedResponseContent) {
				throw new Error('Kiro response ended without text, reasoning, or tool-use content.');
			}

			for (const use of toolUses.values()) {
				const parsedInput = use.inputValue ?? parseToolInput(use.inputText);
				if (use.inputText.trim() && !parsedInput) {
					throw new Error(`Kiro returned invalid JSON input for tool "${use.name}".`);
				}
				progress.report(new LanguageModelToolCallPart(use.callId, use.name, parsedInput ?? {}));
			}
		} catch (error) {
			controller.abort();
			throw error;
		} finally {
			cancellation.dispose();
		}
	}

	async provideTokenCount(_model: KiroLanguageModelChatInformation, text: string | LanguageModelChatMessage | LanguageModelChatMessage2, _token: CancellationToken): Promise<number> {
		let serialized: string;
		if (typeof text === 'string') {
			serialized = text;
		} else {
			try {
				serialized = JSON.stringify(text);
			} catch {
				serialized = String(text);
			}
		}
		return Math.ceil(serialized.length / 4);
	}
}
