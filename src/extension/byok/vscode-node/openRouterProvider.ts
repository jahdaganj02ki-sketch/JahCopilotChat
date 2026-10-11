/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { BYOKModelCapabilities } from '../common/byokProvider';
import { isOpenRouterFreeModel } from '../common/freeModelUtils';
import { AbstractOpenAICompatibleLMProvider } from './abstractLanguageModelChatProvider';
import { IBYOKStorageService } from './byokStorageService';

interface OpenRouterModelData {
	id: string;
	name?: string;
	supported_parameters?: string[];
	architecture?: {
		input_modalities?: string[];
	};
	context_length?: number;
	top_provider?: {
		context_length?: number;
	};
}

export class OpenRouterLMProvider extends AbstractOpenAICompatibleLMProvider {
	public static readonly providerName = 'OpenRouter';
	constructor(
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(
			OpenRouterLMProvider.providerName.toLowerCase(),
			OpenRouterLMProvider.providerName,
			undefined,
			byokStorageService,
			fetcherService,
			logService,
			instantiationService,
			configurationService,
			expService
		);
	}

	protected override getModelsBaseUrl(): string | undefined {
		return 'https://openrouter.ai/api/v1';
	}

	protected override getModelsDiscoveryUrl(modelsBaseUrl: string): string {
		return `${modelsBaseUrl}/models?supported_parameters=tools`;
	}

	protected override requiresApiKeyForModelDiscovery(): boolean {
		return false;
	}

	protected override shouldIncludeModel(modelData: unknown): boolean {
		return isOpenRouterFreeModel(modelData);
	}

	protected override resolveModelCapabilities(modelData: unknown): BYOKModelCapabilities | undefined {
		const openRouterModelData = modelData as OpenRouterModelData;
		const contextLength = openRouterModelData.top_provider?.context_length ?? openRouterModelData.context_length ?? 128000;
		const maxOutputTokens = Math.min(16000, Math.max(1024, Math.floor(contextLength / 4)));
		return {
			name: openRouterModelData.name ?? openRouterModelData.id,
			toolCalling: openRouterModelData.supported_parameters?.includes('tools') ?? false,
			vision: openRouterModelData.architecture?.input_modalities?.includes('image') ?? false,
			maxInputTokens: Math.max(1024, contextLength - maxOutputTokens),
			maxOutputTokens
		};
	}

}