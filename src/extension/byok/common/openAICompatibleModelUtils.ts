/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 JahCopilotChat contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BYOKModelCapabilities } from './byokProvider';
import { asModelRecord, getModelId } from './freeModelUtils';

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
	}
	return undefined;
}

function firstPositiveNumber(records: Array<Record<string, unknown> | undefined>, keys: readonly string[]): number | undefined {
	for (const record of records) {
		if (!record) {
			continue;
		}
		for (const key of keys) {
			const value = record[key];
			const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
			if (Number.isFinite(numberValue) && numberValue > 0) {
				return Math.floor(numberValue);
			}
		}
	}
	return undefined;
}

function firstBoolean(records: Array<Record<string, unknown> | undefined>, keys: readonly string[]): boolean | undefined {
	for (const record of records) {
		if (!record) {
			continue;
		}
		for (const key of keys) {
			if (typeof record[key] === 'boolean') {
				return record[key] as boolean;
			}
		}
	}
	return undefined;
}

function readStringArray(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === 'string').map(item => item.trim().toLowerCase()).filter(Boolean);
	}
	return typeof value === 'string' ? [value.trim().toLowerCase()].filter(Boolean) : [];
}

function isNonChatModel(model: Record<string, unknown>, id: string, name: string): boolean {
	const task = asModelRecord(model.task);
	const metadata = [
		id,
		name,
		firstString(model, ['type', 'model_type', 'task', 'task_name', 'output_modality']) ?? '',
		firstString(task ?? {}, ['name', 'type', 'task_name']) ?? '',
	].join(' ').toLowerCase();
	const inputModalities = readStringArray(model.input_modalities ?? model.inputModalities);
	const outputModalities = readStringArray(model.output_modalities ?? model.outputModalities);
	const hasNoTextInput = inputModalities.length > 0 && !inputModalities.includes('text');
	const hasNoTextOutput = outputModalities.length > 0 && !outputModalities.includes('text');
	return hasNoTextInput || hasNoTextOutput || /(?:embedding|embedder|rerank(?:er|ing)?|text[- ]?to[- ]?speech|\btts\b|transcription|transcribe|\basr\b|\bwhisper\b|image generation|video generation|content safety|moderation)/.test(metadata);
}

export interface OpenAICompatibleModelCapabilityDefaults {
	/** Fallback only when the model catalog doesn't report tool support. */
	readonly toolCalling?: boolean;
}

/**
 * Resolves useful picker limits and capabilities from common OpenAI-compatible
 * provider catalog fields. Unknown models remain usable with conservative
 * defaults; catalog entries for embedding, reranking, and audio-only models are
 * omitted because this provider implements chat completions.
 */
export function resolveOpenAICompatibleModelCapabilities(
	modelData: unknown,
	defaults?: OpenAICompatibleModelCapabilityDefaults,
): BYOKModelCapabilities | undefined {
	const model = asModelRecord(modelData);
	const id = getModelId(modelData);
	if (!model || !id) {
		return undefined;
	}

	const architecture = asModelRecord(model.architecture);
	const capabilities = asModelRecord(model.capabilities);
	const limits = asModelRecord(model.limits);
	const topProvider = asModelRecord(model.top_provider);
	const metadataRecords = [model, capabilities, limits, architecture, topProvider];

	const name = firstString(model, ['name', 'display_name', 'displayName', 'title']) ?? id;
	if (isNonChatModel(model, id, name)) {
		return undefined;
	}

	const contextWindow = firstPositiveNumber(metadataRecords, [
		'context_length',
		'contextLength',
		'context_window',
		'contextWindow',
		'max_context_tokens',
		'max_context_length',
		'max_context_window_tokens',
	]);
	const outputLimit = firstPositiveNumber(metadataRecords, [
		'max_output_tokens',
		'maxOutputTokens',
		'max_completion_tokens',
		'maxCompletionTokens',
		'max_tokens',
	]);
	const maxOutputTokens = outputLimit ?? 8192;
	const maxInputTokens = contextWindow ? Math.max(1024, contextWindow - maxOutputTokens) : 64_000;

	const supportedParameters = readStringArray(model.supported_parameters ?? model.supportedParameters);
	const explicitToolSupport = firstBoolean(metadataRecords, ['tool_calling', 'toolCalling', 'supports_tools', 'supportsTools', 'tool_calls', 'toolCalls']);
	const toolCalling = explicitToolSupport ?? (supportedParameters.includes('tools') ? true : supportedParameters.length > 0 ? false : defaults?.toolCalling ?? true);

	const inputModalities = [
		...readStringArray(model.input_modalities),
		...readStringArray(model.inputModalities),
		...readStringArray(architecture?.input_modalities),
		...readStringArray(architecture?.inputModalities),
	];
	const explicitVisionSupport = firstBoolean(metadataRecords, ['vision', 'supports_vision', 'supportsVision', 'image_input', 'imageInput']);
	const vision = explicitVisionSupport ?? inputModalities.some(modality => /image|vision|video/.test(modality));
	const thinking = firstBoolean(metadataRecords, ['thinking', 'reasoning', 'supports_reasoning', 'supportsReasoning']) ?? false;

	return {
		name,
		maxInputTokens,
		maxOutputTokens,
		toolCalling,
		vision,
		thinking,
		streaming: true,
	};
}
