/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 JahCopilotChat contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Minimal Kiro/Amazon Q transport helpers used by the experimental Kiro picker provider.
 * This is a Kiro-specific protocol adapter, not an OpenAI-compatible public API client.
 */

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const MAX_EVENT_FRAME_BYTES = 8 * 1024 * 1024;

export interface KiroModelEntry {
	readonly id: string;
	readonly name: string;
	readonly maxInputTokens: number;
	readonly maxOutputTokens: number;
	readonly imageInput: boolean;
	readonly rateMultiplier?: number;
}

export interface KiroChatMessage {
	readonly role: number | string;
	readonly content: readonly unknown[] | string;
	readonly name?: string;
}

export interface KiroChatTool {
	readonly name: string;
	readonly description?: string;
	readonly inputSchema?: unknown;
}

export interface KiroRequestOptions {
	readonly conversationId: string;
	readonly maxTokens?: number;
	readonly temperature?: number;
	readonly requireTool?: boolean;
}

export interface KiroEvent {
	readonly headers: Readonly<Record<string, unknown>>;
	readonly payload: unknown;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function positiveInteger(value: unknown, fallback: number): number {
	const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
	return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function readText(content: readonly unknown[] | string): string {
	if (typeof content === 'string') {
		return content;
	}
	const values: string[] = [];
	for (const part of content) {
		const record = asRecord(part);
		if (typeof record?.value === 'string') {
			values.push(record.value);
		} else if (typeof record?.text === 'string') {
			values.push(record.text);
		}
	}
	return values.join('');
}

function roleOf(message: KiroChatMessage): 'system' | 'assistant' | 'user' {
	if (message.role === 3 || message.role === 'system') {
		return 'system';
	}
	if (message.role === 2 || message.role === 'assistant') {
		return 'assistant';
	}
	return 'user';
}

function extractImages(content: readonly unknown[]): Array<{ format: string; source: { bytes: string } }> {
	const images: Array<{ format: string; source: { bytes: string } }> = [];
	for (const part of content) {
		const record = asRecord(part);
		const mimeType = record?.mimeType;
		const data = record?.data;
		if (typeof mimeType !== 'string' || !mimeType.startsWith('image/') || !(data instanceof Uint8Array)) {
			continue;
		}
		const subtype = mimeType.slice('image/'.length).split(';', 1)[0];
		images.push({ format: subtype === 'jpg' ? 'jpeg' : subtype, source: { bytes: Buffer.from(data).toString('base64') } });
	}
	return images;
}

function extractToolResults(content: readonly unknown[]): Array<{ toolUseId: string; status: 'success' | 'error'; content: Array<{ text: string }> }> {
	const results: Array<{ toolUseId: string; status: 'success' | 'error'; content: Array<{ text: string }> }> = [];
	for (const part of content) {
		const record = asRecord(part);
		if (typeof record?.callId !== 'string' || !Array.isArray(record.content)) {
			continue;
		}
		results.push({
			toolUseId: record.callId,
			status: record.isError === true || record.status === 'error' ? 'error' : 'success',
			content: [{ text: readText(record.content) }],
		});
	}
	return results;
}

function extractToolUses(content: readonly unknown[]): Array<{ toolUseId: string; name: string; input: unknown }> {
	const toolUses: Array<{ toolUseId: string; name: string; input: unknown }> = [];
	for (const part of content) {
		const record = asRecord(part);
		if (typeof record?.callId !== 'string' || typeof record.name !== 'string') {
			continue;
		}
		toolUses.push({
			toolUseId: record.callId,
			name: record.name,
			input: asRecord(record.input) ?? {},
		});
	}
	return toolUses;
}

function mergeUserTurns(turns: JsonRecord[]): JsonRecord[] {
	const merged: JsonRecord[] = [];
	for (const turn of turns) {
		const userMessage = asRecord(turn.userInputMessage);
		const previous = merged.length > 0 ? asRecord(merged[merged.length - 1].userInputMessage) : undefined;
		if (!userMessage || !previous) {
			merged.push(turn);
			continue;
		}
		previous.content = [previous.content, userMessage.content].filter((item): item is string => typeof item === 'string' && item.length > 0).join('\n\n');
		const previousContext = asRecord(previous.userInputMessageContext);
		const currentContext = asRecord(userMessage.userInputMessageContext);
		if (currentContext) {
			const combined = previousContext ?? {};
			for (const key of ['toolResults', 'tools', 'images'] as const) {
				const current = currentContext[key];
				if (Array.isArray(current) && current.length > 0) {
					combined[key] = [...(Array.isArray(combined[key]) ? combined[key] as unknown[] : []), ...current];
				}
			}
			previous.userInputMessageContext = combined;
		}
	}
	return merged;
}

/** Convert VS Code chat history into the documented shape expected by the 9Router Kiro adapter. */
export function buildKiroRequest(
	modelId: string,
	messages: readonly KiroChatMessage[],
	tools: readonly KiroChatTool[],
	options: KiroRequestOptions,
): JsonRecord {
	const systemInstructions = messages.filter(message => roleOf(message) === 'system').map(message => readText(message.content)).filter(Boolean);
	if (options.requireTool && tools.length > 0) {
		systemInstructions.push('The caller requires a tool call. Choose and use one of the available tools before providing a final response.');
	}
	const turns: JsonRecord[] = [];
	for (const message of messages) {
		const role = roleOf(message);
		if (role === 'system') {
			continue;
		}
		const contentParts = typeof message.content === 'string' ? [] : message.content;
		if (role === 'assistant') {
			const content = readText(message.content).trim();
			const toolUses = extractToolUses(contentParts);
			turns.push({ assistantResponseMessage: { content, ...(toolUses.length > 0 ? { toolUses } : {}) } });
			continue;
		}

		const userContext: JsonRecord = {};
		const toolResults = extractToolResults(contentParts);
		const images = extractImages(contentParts);
		if (toolResults.length > 0) {
			userContext.toolResults = toolResults;
		}
		if (images.length > 0) {
			userContext.images = images;
		}
		const content = readText(message.content);
		turns.push({
			userInputMessage: {
				content: content || (toolResults.length > 0 ? 'Tool result' : ''),
				modelId,
				...(Object.keys(userContext).length > 0 ? { userInputMessageContext: userContext } : {}),
			},
		});
	}

	const history = mergeUserTurns(turns);
	let currentMessage: JsonRecord | undefined;
	if (history[history.length - 1]?.userInputMessage) {
		currentMessage = history.pop();
	}
	if (!currentMessage) {
		currentMessage = { userInputMessage: { content: '', modelId } };
	}

	const current = asRecord(currentMessage.userInputMessage)!;
	if (systemInstructions.length > 0) {
		const instructions = `<instructions>\n${systemInstructions.join('\n\n')}\n</instructions>`;
		current.content = [instructions, current.content].filter(value => typeof value === 'string' && value.length > 0).join('\n\n');
	}

	if (tools.length > 0) {
		const context = asRecord(current.userInputMessageContext) ?? {};
		context.tools = tools.map(tool => ({
			toolSpecification: {
				name: tool.name,
				description: tool.description ?? '',
				inputSchema: { json: asRecord(tool.inputSchema) ?? { type: 'object', properties: {} } },
			},
		}));
		current.userInputMessageContext = context;
	}

	const currentUserMessage = {
		...current,
		modelId,
		origin: 'AI_EDITOR',
	};
	const maxTokens = Math.min(32_000, positiveInteger(options.maxTokens, 8192));
	const inferenceConfig: JsonRecord = { maxTokens };
	if (typeof options.temperature === 'number' && Number.isFinite(options.temperature)) {
		inferenceConfig.temperature = Math.max(0, Math.min(1, options.temperature));
	}

	return {
		conversationState: {
			chatTriggerType: 'MANUAL',
			conversationId: options.conversationId,
			currentMessage: { userInputMessage: currentUserMessage },
			history,
		},
		inferenceConfig,
	};
}

/** Normalize the account-specific Kiro model catalog. Invalid entries are ignored. */
export function normalizeKiroModelCatalog(payload: unknown): KiroModelEntry[] {
	const root = asRecord(payload);
	const nestedData = asRecord(root?.data);
	const rawModels = Array.isArray(root?.models) ? root.models : Array.isArray(nestedData?.models) ? nestedData.models : [];
	const models: KiroModelEntry[] = []; 
	const seen = new Set<string>();
	for (const candidate of rawModels) {
		const raw = asRecord(candidate);
		const id = typeof raw?.modelId === 'string' ? raw.modelId.trim() : typeof raw?.id === 'string' ? raw.id.trim() : '';
		if (!id || seen.has(id)) {
			continue;
		}
		seen.add(id);
		const tokenLimits = asRecord(raw?.tokenLimits);
		const capabilities = asRecord(raw?.capabilities);
		const inputModalities = Array.isArray(raw?.inputModalities) ? raw.inputModalities : [];
		const imageInput = raw?.imageInput === true || raw?.supportsImages === true || raw?.vision === true || capabilities?.imageInput === true || inputModalities.some(modality => typeof modality === 'string' && /image|vision/i.test(modality));
		const rawRateMultiplier = typeof raw?.rateMultiplier === 'number' ? raw.rateMultiplier : typeof raw?.rateMultiplier === 'string' ? Number(raw.rateMultiplier) : Number.NaN;
		const rateMultiplier = Number.isFinite(rawRateMultiplier) && rawRateMultiplier > 0 ? rawRateMultiplier : undefined;
		const name = [raw?.modelName, raw?.displayName, raw?.name].find(value => typeof value === 'string' && value.trim());
		models.push({
			id,
			name: typeof name === 'string' ? name.trim() : id,
			maxInputTokens: positiveInteger(tokenLimits?.maxInputTokens ?? raw?.maxInputTokens ?? raw?.contextLength, 128_000),
			maxOutputTokens: positiveInteger(tokenLimits?.maxOutputTokens ?? raw?.maxOutputTokens, 8_192),
			imageInput,
			...(rateMultiplier ? { rateMultiplier } : {}),
		});
	}
	return models;
}

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_unused, index) => {
	let value = index;
	for (let bit = 0; bit < 8; bit++) {
		value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
	}
	return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/** Parse and validate one complete AWS EventStream frame. */
export function parseKiroEventFrame(frame: Uint8Array): KiroEvent {
	if (frame.byteLength < 16) {
		throw new Error('Kiro EventStream frame is shorter than its minimum size');
	}
	const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
	const totalLength = view.getUint32(0, false);
	const headersLength = view.getUint32(4, false);
	if (totalLength !== frame.byteLength || totalLength > MAX_EVENT_FRAME_BYTES || headersLength > totalLength - 16) {
		throw new Error('Kiro EventStream frame has invalid length fields');
	}
	if (view.getUint32(8, false) !== crc32(frame.subarray(0, 8))) {
		throw new Error('Kiro EventStream prelude checksum failed');
	}
	if (view.getUint32(totalLength - 4, false) !== crc32(frame.subarray(0, totalLength - 4))) {
		throw new Error('Kiro EventStream message checksum failed');
	}

	const headers: Record<string, unknown> = {};
	let offset = 12;
	const headersEnd = 12 + headersLength;
	const requireHeaderBytes = (length: number): void => {
		if (offset + length > headersEnd) {
			throw new Error('Kiro EventStream header exceeds its declared size');
		}
	};
	while (offset < headersEnd) {
		requireHeaderBytes(1);
		const nameLength = frame[offset++];
		requireHeaderBytes(nameLength + 1);
		const name = textDecoder.decode(frame.subarray(offset, offset + nameLength));
		offset += nameLength;
		const type = frame[offset++];
		if (Object.prototype.hasOwnProperty.call(headers, name)) {
			throw new Error(`Kiro EventStream contains a duplicate header: ${name}`);
		}
		if (type === 0 || type === 1) {
			headers[name] = type === 0;
		} else if (type === 2) {
			requireHeaderBytes(1);
			headers[name] = view.getInt8(offset++);
		} else if (type === 3) {
			requireHeaderBytes(2);
			headers[name] = view.getInt16(offset, false);
			offset += 2;
		} else if (type === 4) {
			requireHeaderBytes(4);
			headers[name] = view.getInt32(offset, false);
			offset += 4;
		} else if (type === 5 || type === 8) {
			requireHeaderBytes(8);
			offset += 8;
		} else if (type === 6 || type === 7) {
			requireHeaderBytes(2);
			const valueLength = view.getUint16(offset, false);
			offset += 2;
			requireHeaderBytes(valueLength);
			const value = frame.subarray(offset, offset + valueLength);
			headers[name] = type === 7 ? textDecoder.decode(value) : value;
			offset += valueLength;
		} else if (type === 9) {
			requireHeaderBytes(16);
			offset += 16;
		} else {
			throw new Error(`Kiro EventStream header ${name} has an unknown type`);
		}
	}

	const payloadBytes = frame.subarray(headersEnd, totalLength - 4);
	if (payloadBytes.byteLength === 0) {
		return { headers, payload: null };
	}
	const payloadText = textDecoder.decode(payloadBytes);
	try {
		return { headers, payload: JSON.parse(payloadText) as unknown };
	} catch (error) {
		throw new Error(`Kiro EventStream payload was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** Decode AWS EventStream frames from a chunked fetch response without assuming chunk boundaries. */
export async function* readKiroEventStream(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<KiroEvent> {
	let pending = new Uint8Array(0);
	for await (const chunk of chunks) {
		if (!(chunk instanceof Uint8Array)) {
			throw new Error('Kiro EventStream returned a non-binary chunk');
		}
		const combined = new Uint8Array(pending.byteLength + chunk.byteLength);
		combined.set(pending);
		combined.set(chunk, pending.byteLength);
		pending = combined;
		while (pending.byteLength >= 12) {
			const frameLength = new DataView(pending.buffer, pending.byteOffset, pending.byteLength).getUint32(0, false);
			if (frameLength < 16 || frameLength > MAX_EVENT_FRAME_BYTES) {
				throw new Error('Kiro EventStream announced an invalid frame length');
			}
			if (pending.byteLength < frameLength) {
				break;
			}
			yield parseKiroEventFrame(pending.subarray(0, frameLength));
			pending = pending.slice(frameLength);
		}
	}
	if (pending.byteLength > 0) {
		throw new Error('Kiro EventStream ended with an incomplete frame');
	}
}

/** Test/helper encoder for a single AWS EventStream event with string headers and JSON payload. */
export function encodeKiroEventFrame(headers: Readonly<Record<string, string>>, payload: unknown): Uint8Array {
	const headerChunks = Object.entries(headers).map(([name, value]) => {
		const nameBytes = textEncoder.encode(name);
		const valueBytes = textEncoder.encode(value);
		const bytes = new Uint8Array(1 + nameBytes.byteLength + 1 + 2 + valueBytes.byteLength);
		const view = new DataView(bytes.buffer);
		let offset = 0;
		bytes[offset++] = nameBytes.byteLength;
		bytes.set(nameBytes, offset);
		offset += nameBytes.byteLength;
		bytes[offset++] = 7;
		view.setUint16(offset, valueBytes.byteLength, false);
		offset += 2;
		bytes.set(valueBytes, offset);
		return bytes;
	});
	const headersLength = headerChunks.reduce((length, chunk) => length + chunk.byteLength, 0);
	const payloadBytes = textEncoder.encode(JSON.stringify(payload));
	const totalLength = 16 + headersLength + payloadBytes.byteLength;
	const frame = new Uint8Array(totalLength);
	const view = new DataView(frame.buffer);
	view.setUint32(0, totalLength, false);
	view.setUint32(4, headersLength, false);
	view.setUint32(8, crc32(frame.subarray(0, 8)), false);
	let offset = 12;
	for (const header of headerChunks) {
		frame.set(header, offset);
		offset += header.byteLength;
	}
	frame.set(payloadBytes, offset);
	view.setUint32(totalLength - 4, crc32(frame.subarray(0, totalLength - 4)), false);
	return frame;
}
