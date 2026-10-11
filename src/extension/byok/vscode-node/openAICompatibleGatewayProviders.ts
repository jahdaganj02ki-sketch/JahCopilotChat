/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 JahCopilotChat contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { BYOKKnownModels, BYOKModelCapabilities, byokKnownModelsToAPIInfo } from '../common/byokProvider';
import { asModelRecord, getModelId } from '../common/freeModelUtils';
import { OpenAICompatibleModelCapabilityDefaults, resolveOpenAICompatibleModelCapabilities } from '../common/openAICompatibleModelUtils';
import { AbstractOpenAICompatibleLMProvider, LanguageModelChatConfiguration, OpenAICompatibleLanguageModelChatInformation } from './abstractLanguageModelChatProvider';
import { IBYOKStorageService } from './byokStorageService';

abstract class OpenAICompatibleGatewayProvider extends AbstractOpenAICompatibleLMProvider {
	protected constructor(
		id: string,
		name: string,
		private readonly _baseUrl: string,
		byokStorageService: IBYOKStorageService,
		fetcherService: IFetcherService,
		logService: ILogService,
		instantiationService: IInstantiationService,
		configurationService: IConfigurationService,
		expService: IExperimentationService
	) {
		super(id, name, undefined, byokStorageService, fetcherService, logService, instantiationService, configurationService, expService);
	}

	protected override getModelsBaseUrl(_configuration: LanguageModelChatConfiguration | undefined): string {
		return this._baseUrl;
	}

	protected override resolveModelCapabilities(modelData: unknown): BYOKModelCapabilities | undefined {
		return resolveOpenAICompatibleModelCapabilities(modelData);
	}
}

export interface KiloOpenAICompatibleProviderPreset {
	readonly id: string;
	readonly name: string;
	readonly baseUrl: string;
	/** Whether silent model discovery should wait for an API key to be configured. */
	readonly requiresApiKeyForDiscovery?: boolean;
	/** Local services are contacted only after the user explicitly configures a base URL. */
	readonly requiresConfiguredBaseUrl?: boolean;
}

/**
 * Kilo Code providers which expose the OpenAI Chat Completions API and a
 * compatible `/models` catalog. Native-auth/protocol providers are kept out of
 * this list and should be implemented with their own transport.
 */
export const KILO_OPENAI_COMPATIBLE_PROVIDER_PRESETS: readonly KiloOpenAICompatibleProviderPreset[] = [
	{ id: 'atomic-chat', name: 'Atomic Chat', baseUrl: 'http://127.0.0.1:1337/v1', requiresApiKeyForDiscovery: false, requiresConfiguredBaseUrl: true },
	{ id: 'cerebras', name: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1' },
	{ id: 'chutes', name: 'Chutes', baseUrl: 'https://llm.chutes.ai/v1' },
	{ id: 'daoxe', name: 'DaoXE', baseUrl: 'https://daoxe.com/v1' },
	{ id: 'deepinfra', name: 'DeepInfra', baseUrl: 'https://api.deepinfra.com/v1/openai' },
	{ id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
	{ id: 'edenai', name: 'Eden AI', baseUrl: 'https://api.edenai.run/v3', requiresApiKeyForDiscovery: false },
	{ id: 'fireworks-ai', name: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1' },
	{ id: 'llmgateway', name: 'LLMGateway', baseUrl: 'https://api.llmgateway.io/v1' },
	{ id: 'lmstudio', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', requiresApiKeyForDiscovery: false, requiresConfiguredBaseUrl: true },
	{ id: 'mistral', name: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1' },
	{ id: 'mixlayer', name: 'Mixlayer', baseUrl: 'https://mixlayer.ai/v1' },
	{ id: 'moonshotai', name: 'Moonshot AI', baseUrl: 'https://api.moonshot.ai/v1' },
	{ id: 'nebius', name: 'Nebius Token Factory', baseUrl: 'https://api.tokenfactory.nebius.com/v1' },
	{ id: 'perplexity', name: 'Perplexity', baseUrl: 'https://api.perplexity.ai' },
	{ id: 'poolside', name: 'Poolside', baseUrl: 'https://inference.poolside.ai/v1' },
	{ id: 'synthetic', name: 'Synthetic', baseUrl: 'https://api.synthetic.new/openai/v1' },
	{ id: 'togetherai', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1' },
	{ id: 'trustedrouter', name: 'TrustedRouter', baseUrl: 'https://api.trustedrouter.com/v1' },
	{ id: 'v0', name: 'v0 by Vercel', baseUrl: 'https://api.v0.dev/v1' },
	{ id: 'venice', name: 'Venice AI', baseUrl: 'https://api.venice.ai/api/v1' },
	{ id: 'vercel', name: 'Vercel AI Gateway', baseUrl: 'https://ai-gateway.vercel.sh/v1' },
];

export interface KiloOpenAICompatibleProviderConfiguration extends LanguageModelChatConfiguration {
	readonly url?: string;
}

/** One generic OpenAI-compatible implementation, configured from a named provider preset. */
export class KiloOpenAICompatiblePresetLMProvider extends AbstractOpenAICompatibleLMProvider<KiloOpenAICompatibleProviderConfiguration> {
	private readonly _preset: KiloOpenAICompatibleProviderPreset;

	constructor(
		preset: KiloOpenAICompatibleProviderPreset,
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(preset.id, preset.name, undefined, byokStorageService, fetcherService, logService, instantiationService, configurationService, expService);
		this._preset = preset;
	}

	protected override getModelsBaseUrl(configuration: KiloOpenAICompatibleProviderConfiguration | undefined): string | undefined {
		const configuredUrl = configuration?.url?.trim();
		if (this._preset.requiresConfiguredBaseUrl && !configuredUrl) {
			return undefined;
		}
		const baseUrl = configuredUrl || this._preset.baseUrl;
		return baseUrl.replace(/\/+$/, '') || undefined;
	}

	protected override requiresApiKeyForModelDiscovery(): boolean {
		return this._preset.requiresApiKeyForDiscovery ?? true;
	}

	protected override resolveModelCapabilities(modelData: unknown): BYOKModelCapabilities | undefined {
		return resolveOpenAICompatibleModelCapabilities(modelData);
	}
}

export class GroqLMProvider extends OpenAICompatibleGatewayProvider {
	public static readonly providerName = 'Groq';
	public static readonly providerId = 'groq';
	private static readonly baseUrl = 'https://api.groq.com/openai/v1';

	constructor(
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(GroqLMProvider.providerId, GroqLMProvider.providerName, GroqLMProvider.baseUrl, byokStorageService, fetcherService, logService, instantiationService, configurationService, expService);
	}
}

export class ZenMuxLMProvider extends OpenAICompatibleGatewayProvider {
	public static readonly providerName = 'ZenMux';
	public static readonly providerId = 'zenmux';
	private static readonly baseUrl = 'https://zenmux.ai/api/v1';

	constructor(
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(ZenMuxLMProvider.providerId, ZenMuxLMProvider.providerName, ZenMuxLMProvider.baseUrl, byokStorageService, fetcherService, logService, instantiationService, configurationService, expService);
	}
}

export interface CloudflareWorkersAIConfiguration extends LanguageModelChatConfiguration {
	readonly accountId?: string;
}

const CLOUDFLARE_API_BASE_URL = 'https://api.cloudflare.com/client/v4';
const CLOUDFLARE_MODELS_PAGE_SIZE = 100;
const CLOUDFLARE_MODELS_MAX_PAGES = 100;

function isCloudflareAccountId(value: string | undefined): value is string {
	return typeof value === 'string' && /^[\da-f]{32}$/i.test(value.trim());
}

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

function normalizePropertyKey(value: string): string {
	return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function cloudflarePropertiesToRecord(value: unknown): Record<string, unknown> {
	const objectProperties = asModelRecord(value);
	if (objectProperties) {
		return objectProperties;
	}
	if (!Array.isArray(value)) {
		return {};
	}

	const properties: Record<string, unknown> = {};
	for (const item of value) {
		const entry = asModelRecord(item);
		if (!entry) {
			continue;
		}
		const nestedProperty = asModelRecord(entry.property);
		const name = firstString(entry, ['property_name', 'propertyName', 'name', 'key', 'slug'])
			?? firstString(nestedProperty ?? {}, ['property_name', 'propertyName', 'name', 'key', 'slug', 'id']);
		const propertyValue = entry.value ?? entry.default_value ?? entry.defaultValue ?? entry.default;
		if (name && propertyValue !== undefined) {
			properties[normalizePropertyKey(name)] = propertyValue;
		}
	}
	return properties;
}

function normalizeCloudflareModel(value: unknown): Record<string, unknown> | undefined {
	const model = asModelRecord(value);
	if (!model) {
		return undefined;
	}

	// The Cloudflare catalog uses `name` as the inference model ID; `id` may be
	// a numeric catalog record ID, so prefer the API model-name fields.
	const id = firstString(model, ['model_id', 'modelId', 'slug', 'name', 'model', 'id']);
	if (!id) {
		return undefined;
	}

	const displayName = firstString(model, ['display_name', 'displayName', 'title', 'label']) ?? id;
	const properties = cloudflarePropertiesToRecord(model.properties);
	const limits = { ...properties, ...(asModelRecord(model.limits) ?? {}) };
	const contextLength = firstPositiveNumber([model, limits], [
		'context_length',
		'contextLength',
		'context_window',
		'contextWindow',
		'max_context_tokens',
		'max_context_length',
		'max_total_tokens',
	]);
	const outputLimit = firstPositiveNumber([model, limits], [
		'max_output_tokens',
		'maxOutputTokens',
		'max_completion_tokens',
		'maxCompletionTokens',
		'max_tokens',
	]);

	return {
		...model,
		id,
		name: displayName,
		limits,
		...(contextLength ? { context_length: contextLength } : {}),
		...(outputLimit ? { max_output_tokens: outputLimit } : {}),
	};
}

function isCloudflareTextGenerationModel(model: Record<string, unknown>): boolean {
	const task = asModelRecord(model.task);
	const taskName = firstString(task ?? {}, ['name', 'type', 'task_name', 'taskName'])
		?? firstString(model, ['task_name', 'taskName', 'task', 'type']);
	return !taskName || /text[\s-]*generation|conversational|chat(?:\s*completions?)?/i.test(taskName);
}

function responseHasMorePages(response: Record<string, unknown>, page: number, pageLength: number): boolean {
	if (pageLength === 0) {
		return false;
	}
	const resultInfo = asModelRecord(response.result_info);
	const currentPage = firstPositiveNumber([resultInfo], ['page']) ?? page;
	const totalPages = firstPositiveNumber([resultInfo], ['total_pages', 'totalPages']);
	if (totalPages !== undefined) {
		return currentPage < totalPages;
	}

	const totalCount = firstPositiveNumber([resultInfo], ['total_count', 'totalCount']);
	if (totalCount !== undefined) {
		const reportedPageSize = firstPositiveNumber([resultInfo], ['per_page', 'perPage']) ?? CLOUDFLARE_MODELS_PAGE_SIZE;
		return currentPage * reportedPageSize < totalCount;
	}
	return pageLength >= CLOUDFLARE_MODELS_PAGE_SIZE;
}

export class CloudflareWorkersAILMProvider extends AbstractOpenAICompatibleLMProvider<CloudflareWorkersAIConfiguration> {
	public static readonly providerName = 'Cloudflare Workers AI';
	public static readonly providerId = 'cloudflare-workers-ai';

	constructor(
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(
			CloudflareWorkersAILMProvider.providerId,
			CloudflareWorkersAILMProvider.providerName,
			undefined,
			byokStorageService,
			fetcherService,
			logService,
			instantiationService,
			configurationService,
			expService
		);
	}

	protected override getModelsBaseUrl(configuration: CloudflareWorkersAIConfiguration | undefined): string | undefined {
		const accountId = configuration?.accountId?.trim();
		if (!isCloudflareAccountId(accountId)) {
			return undefined;
		}
		return `${CLOUDFLARE_API_BASE_URL}/accounts/${accountId}/ai/v1`;
	}

	protected override resolveModelCapabilities(modelData: unknown): BYOKModelCapabilities | undefined {
		// Cloudflare's model catalog does not consistently advertise tool support.
		// Only enable tools when its metadata explicitly says they are supported.
		const defaults: OpenAICompatibleModelCapabilityDefaults = { toolCalling: false };
		return resolveOpenAICompatibleModelCapabilities(modelData, defaults);
	}

	protected override async getAllModels(
		_silent: boolean,
		apiKey: string | undefined,
		configuration: CloudflareWorkersAIConfiguration | undefined
	): Promise<OpenAICompatibleLanguageModelChatInformation<CloudflareWorkersAIConfiguration>[]> {
		const accountId = configuration?.accountId?.trim();
		const inferenceBaseUrl = this.getModelsBaseUrl(configuration);
		if (!inferenceBaseUrl || !isCloudflareAccountId(accountId) || !apiKey) {
			return [];
		}

		try {
			const catalog = await this.fetchCloudflareModels(accountId, apiKey);
			const models: BYOKKnownModels = {};
			for (const rawModel of catalog) {
				const model = normalizeCloudflareModel(rawModel);
				if (!model || !isCloudflareTextGenerationModel(model)) {
					continue;
				}
				const id = getModelId(model);
				if (!id) {
					continue;
				}

				let capabilities = this._knownModels?.[id];
				if (!capabilities) {
					capabilities = this.resolveModelCapabilities(model);
					if (!capabilities) {
						continue;
					}
					this._knownModels ??= {};
					this._knownModels[id] = capabilities;
				}
				models[id] = capabilities;
			}

			return byokKnownModelsToAPIInfo(this._name, models).map(model => ({
				...model,
				url: inferenceBaseUrl,
			}));
		} catch (error) {
			this._logService.error(error, `Error fetching available ${this._name} models`);
			throw error;
		}
	}

	private async fetchCloudflareModels(accountId: string, apiKey: string): Promise<unknown[]> {
		const models: unknown[] = [];
		let page = 1;

		while (page <= CLOUDFLARE_MODELS_MAX_PAGES) {
			const url = new URL(`${CLOUDFLARE_API_BASE_URL}/accounts/${accountId}/ai/models/search`);
			url.searchParams.set('task', 'Text Generation');
			url.searchParams.set('hide_experimental', 'true');
			url.searchParams.set('per_page', String(CLOUDFLARE_MODELS_PAGE_SIZE));
			url.searchParams.set('page', String(page));

			const response = await this._fetcherService.fetch(url.toString(), {
				method: 'GET',
				headers: {
					Accept: 'application/json',
					Authorization: `Bearer ${apiKey}`,
				},
				callSite: 'byok-models-discovery',
			});
			if (!response.ok) {
				throw new Error(`Cloudflare Workers AI model discovery failed (${response.status} ${response.statusText}).`);
			}

			const data = asModelRecord(await response.json());
			if (!data || data.success === false || !Array.isArray(data.result)) {
				throw new Error('Invalid Cloudflare Workers AI model catalog response: expected a successful `result` array.');
			}

			models.push(...data.result);
			if (!responseHasMorePages(data, page, data.result.length)) {
				break;
			}
			if (page === CLOUDFLARE_MODELS_MAX_PAGES) {
				this._logService.warn(`Cloudflare Workers AI model discovery stopped after ${CLOUDFLARE_MODELS_MAX_PAGES} pages.`);
				break;
			}
			page++;
		}

		return models;
	}
}
