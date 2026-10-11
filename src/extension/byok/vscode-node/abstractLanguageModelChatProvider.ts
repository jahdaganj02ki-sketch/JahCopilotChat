/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, commands, LanguageModelChatInformation, LanguageModelChatMessage, LanguageModelChatMessage2, LanguageModelChatProvider, LanguageModelResponsePart2, PrepareLanguageModelChatModelOptions, Progress, ProvideLanguageModelChatResponseOptions } from 'vscode';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IChatModelInformation, ModelSupportedEndpoint } from '../../../platform/endpoint/common/endpointProvider';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { IStringDictionary } from '../../../util/vs/base/common/collections';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { CopilotLanguageModelWrapper } from '../../conversation/vscode-node/languageModelAccess';
import { BYOKAuthType, BYOKKnownModels, byokKnownModelsToAPIInfo, BYOKModelCapabilities, resolveModelInfo } from '../common/byokProvider';
import { getModelId } from '../common/freeModelUtils';
import { OpenAIEndpoint } from '../node/openAIEndpoint';
import { IBYOKStorageService } from './byokStorageService';

export interface LanguageModelChatConfiguration {
	readonly apiKey?: string;
}

export interface ExtendedLanguageModelChatInformation<C extends LanguageModelChatConfiguration> extends LanguageModelChatInformation {
	readonly configuration?: C;
}

export abstract class AbstractLanguageModelChatProvider<C extends LanguageModelChatConfiguration = LanguageModelChatConfiguration, T extends ExtendedLanguageModelChatInformation<C> = ExtendedLanguageModelChatInformation<C>> implements LanguageModelChatProvider<T> {

	constructor(
		protected readonly _id: string,
		protected readonly _name: string,
		protected _knownModels: BYOKKnownModels | undefined,
		protected readonly _byokStorageService: IBYOKStorageService,
		@ILogService protected readonly _logService: ILogService,
	) {
		this.configureDefaultGroupWithApiKeyOnly();
	}

	// TODO: Remove this after 6 months
	protected async configureDefaultGroupWithApiKeyOnly(): Promise<string | undefined> {
		const apiKey = await this._byokStorageService.getAPIKey(this._name);
		if (apiKey) {
			this.configureDefaultGroupIfExists(this._name, { apiKey } as C);
			await this._byokStorageService.deleteAPIKey(this._name, BYOKAuthType.GlobalApiKey);
		}
		return apiKey;
	}

	protected async configureDefaultGroupIfExists(name: string, configuration: C): Promise<void> {
		await commands.executeCommand('lm.migrateLanguageModelsProviderGroup', { vendor: this._id, name, ...configuration });
	}

	async provideLanguageModelChatInformation({ silent, configuration }: PrepareLanguageModelChatModelOptions, token: CancellationToken): Promise<T[]> {
		let apiKey: string | undefined = (configuration as C)?.apiKey;
		if (!apiKey) {
			apiKey = await this.configureDefaultGroupWithApiKeyOnly();
		}

		const models = await this.getAllModels(silent, apiKey, configuration as C);
		return models.map(model => ({
			...model,
			apiKey,
			configuration
		}));
	}

	abstract provideLanguageModelChatResponse(model: T, messages: Array<LanguageModelChatMessage | LanguageModelChatMessage2>, options: ProvideLanguageModelChatResponseOptions, progress: Progress<LanguageModelResponsePart2>, token: CancellationToken): Promise<void>;
	abstract provideTokenCount(model: T, text: string | LanguageModelChatMessage | LanguageModelChatMessage2, token: CancellationToken): Promise<number>;
	protected abstract getAllModels(silent: boolean, apiKey: string | undefined, configuration: C | undefined): Promise<T[]>;
}

export interface OpenAICompatibleLanguageModelChatInformation<C extends LanguageModelChatConfiguration> extends ExtendedLanguageModelChatInformation<C> {
	url: string;
}

export abstract class AbstractOpenAICompatibleLMProvider<T extends LanguageModelChatConfiguration = LanguageModelChatConfiguration> extends AbstractLanguageModelChatProvider<T, OpenAICompatibleLanguageModelChatInformation<T>> {
	protected readonly _lmWrapper: CopilotLanguageModelWrapper;

	constructor(
		id: string,
		name: string,
		knownModels: BYOKKnownModels | undefined,
		byokStorageService: IBYOKStorageService,
		@IFetcherService protected readonly _fetcherService: IFetcherService,
		logService: ILogService,
		@IInstantiationService protected readonly _instantiationService: IInstantiationService,
		@IConfigurationService protected readonly _configurationService: IConfigurationService,
		@IExperimentationService protected readonly _expService: IExperimentationService
	) {
		super(id, name, knownModels, byokStorageService, logService);
		this._lmWrapper = this._instantiationService.createInstance(CopilotLanguageModelWrapper);
	}

	async provideLanguageModelChatResponse(model: OpenAICompatibleLanguageModelChatInformation<T>, messages: Array<LanguageModelChatMessage | LanguageModelChatMessage2>, options: ProvideLanguageModelChatResponseOptions, progress: Progress<LanguageModelResponsePart2>, token: CancellationToken): Promise<void> {
		const openAIChatEndpoint = await this.createOpenAIEndPoint(model);
		return this._lmWrapper.provideLanguageModelResponse(openAIChatEndpoint, messages, options, options.requestInitiator, progress, token);
	}

	async provideTokenCount(model: OpenAICompatibleLanguageModelChatInformation<T>, text: string | LanguageModelChatMessage | LanguageModelChatMessage2, token: CancellationToken): Promise<number> {
		const openAIChatEndpoint = await this.createOpenAIEndPoint(model);
		return this._lmWrapper.provideTokenCount(openAIChatEndpoint, text);
	}

	protected async getAllModels(silent: boolean, apiKey: string | undefined, configuration: T | undefined): Promise<OpenAICompatibleLanguageModelChatInformation<T>[]> {
		const modelsUrl = this.getModelsBaseUrl(configuration);
		if (modelsUrl) {
			const models = await this.getModelsFromEndpoint(modelsUrl, silent, apiKey);
			return byokKnownModelsToAPIInfo(this._name, models).map(model => ({
				...model,
				url: modelsUrl
			}));
		}
		return [];
	}

	protected async getModelsFromEndpoint(endpoint: string, silent: boolean, apiKey: string | undefined): Promise<BYOKKnownModels> {
		if (!apiKey && silent && this.requiresApiKeyForModelDiscovery()) {
			return {};
		}

		try {
			const headers: IStringDictionary<string> = {
				'Content-Type': 'application/json',
			};
			if (apiKey) {
				headers['Authorization'] = `Bearer ${apiKey}`;
			}

			const modelsEndpoint = this.getModelsDiscoveryUrl(endpoint);
			const response = await this._fetcherService.fetch(modelsEndpoint, {
				method: 'GET',
				headers,
				callSite: 'byok-models-discovery',
			});
			const data: unknown = await response.json();
			const modelList: BYOKKnownModels = {};

			const responseData = Array.isArray(data) ? undefined : data as { data?: unknown; models?: unknown } | null;
			const models = Array.isArray(data) ? data : responseData?.data ?? responseData?.models;
			if (!Array.isArray(models)) {
				throw new Error('Invalid model catalog response: expected a `data` or `models` array.');
			}

			for (const model of models) {
				if (model === null || typeof model !== 'object' || Array.isArray(model)) {
					continue;
				}
				const modelId = getModelId(model);
				if (!modelId || !this.shouldIncludeModel(model)) {
					continue;
				}

				let modelCapabilities = this._knownModels?.[modelId];
				if (!modelCapabilities) {
					modelCapabilities = this.resolveModelCapabilities(model);
					if (!modelCapabilities) {
						continue;
					}
					if (!this._knownModels) {
						this._knownModels = {};
					}
					this._knownModels[modelId] = modelCapabilities;
				}
				modelList[modelId] = modelCapabilities;
			}
			return modelList;
		} catch (error) {
			this._logService.error(error, `Error fetching available ${this._name} models`);
			throw error;
		}
	}

	/**
	 * Whether catalog discovery can work without a configured provider key.
	 * Providers with public catalogs can override this to keep models visible in
	 * silent model-picker refreshes.
	 */
	protected requiresApiKeyForModelDiscovery(): boolean {
		return true;
	}

	/** Allows providers to hide unavailable, paid, or non-chat models. */
	protected shouldIncludeModel(_modelData: unknown): boolean {
		return true;
	}

	protected async createOpenAIEndPoint(model: OpenAICompatibleLanguageModelChatInformation<T>): Promise<OpenAIEndpoint> {
		const modelInfo = this.getModelInfo(model.id, model.url);
		const url = modelInfo.supported_endpoints?.includes(ModelSupportedEndpoint.Responses) ?
			`${model.url}/responses` :
			`${model.url}/chat/completions`;
		return this._instantiationService.createInstance(OpenAIEndpoint, modelInfo, model.configuration?.apiKey ?? '', url);
	}

	protected getModelInfo(modelId: string, modelUrl: string): IChatModelInformation {
		return resolveModelInfo(modelId, this._name, this._knownModels);
	}

	protected resolveModelCapabilities(modelData: unknown): BYOKModelCapabilities | undefined {
		return undefined;
	}

	protected abstract getModelsBaseUrl(configuration: T | undefined): string | undefined;

	protected getModelsDiscoveryUrl(modelsBaseUrl: string): string {
		return `${modelsBaseUrl}/models`;
	}

}