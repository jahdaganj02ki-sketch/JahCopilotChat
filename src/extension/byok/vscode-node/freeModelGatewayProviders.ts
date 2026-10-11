/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 JahCopilotChat contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IChatModelInformation, ModelSupportedEndpoint } from '../../../platform/endpoint/common/endpointProvider';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { BYOKModelCapabilities, byokKnownModelToAPIInfo } from '../common/byokProvider';
import { resolveOpenAICompatibleModelCapabilities } from '../common/openAICompatibleModelUtils';
import {
	getModelId,
	getOpenCodeZenModelFormat,
	isKiloGatewayFreeModel,
	isNvidiaNimFreeModel,
	isOpenCodeZenFreeModel,
} from '../common/freeModelUtils';
import { AbstractOpenAICompatibleLMProvider, LanguageModelChatConfiguration, OpenAICompatibleLanguageModelChatInformation } from './abstractLanguageModelChatProvider';
import { IBYOKStorageService } from './byokStorageService';

abstract class FreeModelOpenAICompatibleProvider extends AbstractOpenAICompatibleLMProvider {
	protected constructor(
		id: string,
		name: string,
		private readonly _baseUrl: string,
		private readonly _requiresKeyForDiscovery: boolean,
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

	protected override requiresApiKeyForModelDiscovery(): boolean {
		return this._requiresKeyForDiscovery;
	}

	protected override resolveModelCapabilities(modelData: unknown): BYOKModelCapabilities | undefined {
		return resolveOpenAICompatibleModelCapabilities(modelData);
	}

	protected override shouldIncludeModel(modelData: unknown): boolean {
		return this.isFreeModel(modelData);
	}

	protected abstract isFreeModel(modelData: unknown): boolean;
}

export class OpenCodeZenLMProvider extends FreeModelOpenAICompatibleProvider {
	public static readonly providerName = 'OpenCode Zen';
	public static readonly providerId = 'opencodezen';
	private static readonly baseUrl = 'https://opencode.ai/zen/v1';

	constructor(
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(OpenCodeZenLMProvider.providerId, OpenCodeZenLMProvider.providerName, OpenCodeZenLMProvider.baseUrl, false, byokStorageService, fetcherService, logService, instantiationService, configurationService, expService);
	}

	protected override shouldIncludeModel(modelData: unknown): boolean {
		if (!super.shouldIncludeModel(modelData)) {
			return false;
		}

		const modelId = getModelId(modelData);
		if (!modelId) {
			return false;
		}

		// This provider currently implements the two OpenAI-family Zen formats.
		// Don't advertise Anthropic, Google, or System One models as though they
		// accepted OpenAI Chat Completions requests. System One is also not a
		// general chat endpoint. Unknown IDs stay out until their format is mapped.
		const format = getOpenCodeZenModelFormat(modelId);
		return format === 'oa-compat' || format === 'openai';
	}

	protected override getModelInfo(modelId: string, modelUrl: string): IChatModelInformation {
		const modelInfo = super.getModelInfo(modelId, modelUrl);
		switch (getOpenCodeZenModelFormat(modelId)) {
			case 'openai':
				modelInfo.supported_endpoints = [ModelSupportedEndpoint.Responses];
				return modelInfo;
			case 'oa-compat':
				modelInfo.supported_endpoints = [ModelSupportedEndpoint.ChatCompletions];
				return modelInfo;
			default:
				throw new Error(`OpenCode Zen model "${modelId}" uses an API format unsupported by this chat provider.`);
		}
	}

	protected override isFreeModel(modelData: unknown): boolean {
		return isOpenCodeZenFreeModel(modelData);
	}
}

export class NvidiaNimLMProvider extends FreeModelOpenAICompatibleProvider {
	public static readonly providerName = 'NVIDIA NIM';
	public static readonly providerId = 'nvidianim';
	private static readonly baseUrl = 'https://integrate.api.nvidia.com/v1';

	constructor(
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(NvidiaNimLMProvider.providerId, NvidiaNimLMProvider.providerName, NvidiaNimLMProvider.baseUrl, true, byokStorageService, fetcherService, logService, instantiationService, configurationService, expService);
	}

	protected override isFreeModel(modelData: unknown): boolean {
		return isNvidiaNimFreeModel(modelData);
	}
}

export class KiloGatewayLMProvider extends FreeModelOpenAICompatibleProvider {
	public static readonly providerName = 'Kilo Gateway';
	public static readonly providerId = 'kilogateway';
	private static readonly baseUrl = 'https://api.kilo.ai/api/gateway';
	private static readonly autoFreeModelId = 'kilo-auto/free';
	private static readonly autoFreeCapabilities: BYOKModelCapabilities = {
		name: 'Kilo Auto (Free)',
		maxInputTokens: 64_000,
		maxOutputTokens: 8192,
		toolCalling: true,
		vision: true,
		thinking: true,
		streaming: true,
	};

	constructor(
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(KiloGatewayLMProvider.providerId, KiloGatewayLMProvider.providerName, KiloGatewayLMProvider.baseUrl, false, byokStorageService, fetcherService, logService, instantiationService, configurationService, expService);
	}

	protected override isFreeModel(modelData: unknown): boolean {
		return isKiloGatewayFreeModel(modelData);
	}

	protected override async getAllModels(silent: boolean, apiKey: string | undefined, configuration: LanguageModelChatConfiguration | undefined): Promise<OpenAICompatibleLanguageModelChatInformation<LanguageModelChatConfiguration>[]> {
		let models: OpenAICompatibleLanguageModelChatInformation<LanguageModelChatConfiguration>[] = [];
		try {
			models = await super.getAllModels(silent, apiKey, configuration);
		} catch (error) {
			// The catalog is not required to offer Kilo's documented free auto-router.
			this._logService.error(error instanceof Error ? error : String(error), `[${KiloGatewayLMProvider.providerName}] Could not load the model catalog; keeping the free auto-router available.`);
		}

		if (!models.some(model => model.id === KiloGatewayLMProvider.autoFreeModelId)) {
			models.push({
				...byokKnownModelToAPIInfo(this._name, KiloGatewayLMProvider.autoFreeModelId, KiloGatewayLMProvider.autoFreeCapabilities),
				url: KiloGatewayLMProvider.baseUrl,
			});
		}
		return models;
	}
}
