/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { LanguageModelChatInformation, LanguageModelChatProvider, lm } from 'vscode';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { BYOKKnownModels } from '../../byok/common/byokProvider';
import { IExtensionContribution } from '../../common/contributions';
import { AnthropicLMProvider } from './anthropicProvider';
import { AzureBYOKModelProvider } from './azureProvider';
import { BYOKStorageService, IBYOKStorageService } from './byokStorageService';
import { KiloGatewayLMProvider, NvidiaNimLMProvider, OpenCodeZenLMProvider } from './freeModelGatewayProviders';
import { CustomOAIBYOKModelProvider } from './customOAIProvider';
import { KiroLMProvider } from './kiroProvider';
import { GeminiNativeBYOKLMProvider } from './geminiNativeProvider';
import { CloudflareWorkersAILMProvider, GroqLMProvider, KILO_OPENAI_COMPATIBLE_PROVIDER_PRESETS, KiloOpenAICompatiblePresetLMProvider, ZenMuxLMProvider } from './openAICompatibleGatewayProviders';
import { OllamaLMProvider } from './ollamaProvider';
import { OAIBYOKLMProvider } from './openAIProvider';
import { OpenRouterLMProvider } from './openRouterProvider';
import { XAIBYOKLMProvider } from './xAIProvider';

export class BYOKContrib extends Disposable implements IExtensionContribution {
	public readonly id: string = 'byok-contribution';
	private readonly _byokStorageService: IBYOKStorageService;
	private readonly _providers: Map<string, LanguageModelChatProvider<LanguageModelChatInformation>> = new Map();

	constructor(
		@IFetcherService private readonly _fetcherService: IFetcherService,
		@ILogService private readonly _logService: ILogService,
		@IVSCodeExtensionContext extensionContext: IVSCodeExtensionContext,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();
		this._byokStorageService = new BYOKStorageService(extensionContext);

		// Register the providers that do not depend on Copilot account data first.
		// This makes standalone BYOK and free-model providers available even when
		// the user has not signed in to GitHub Copilot.
		this.registerProvidersWithoutCopilotAccount();
		void this.registerProvidersWithKnownModelData();
	}

	private registerProvidersWithoutCopilotAccount(): void {
		this.registerProvider(
			OpenRouterLMProvider.providerName.toLowerCase(),
			this._instantiationService.createInstance(OpenRouterLMProvider, this._byokStorageService)
		);
		this.registerProvider(
			GroqLMProvider.providerId,
			this._instantiationService.createInstance(GroqLMProvider, this._byokStorageService)
		);
		this.registerProvider(
			CloudflareWorkersAILMProvider.providerId,
			this._instantiationService.createInstance(CloudflareWorkersAILMProvider, this._byokStorageService)
		);
		this.registerProvider(
			ZenMuxLMProvider.providerId,
			this._instantiationService.createInstance(ZenMuxLMProvider, this._byokStorageService)
		);
		for (const preset of KILO_OPENAI_COMPATIBLE_PROVIDER_PRESETS) {
			this.registerProvider(
				preset.id,
				this._instantiationService.createInstance(KiloOpenAICompatiblePresetLMProvider, preset, this._byokStorageService)
			);
		}
		this.registerProvider(
			OpenCodeZenLMProvider.providerId,
			this._instantiationService.createInstance(OpenCodeZenLMProvider, this._byokStorageService)
		);
		this.registerProvider(
			NvidiaNimLMProvider.providerId,
			this._instantiationService.createInstance(NvidiaNimLMProvider, this._byokStorageService)
		);
		this.registerProvider(
			KiloGatewayLMProvider.providerId,
			this._instantiationService.createInstance(KiloGatewayLMProvider, this._byokStorageService)
		);
		this.registerProvider(
			KiroLMProvider.providerId,
			this._instantiationService.createInstance(KiroLMProvider, this._byokStorageService)
		);

		// Existing providers that do not rely on the remotely maintained model list.
		this.registerProvider(
			OllamaLMProvider.providerName.toLowerCase(),
			this._instantiationService.createInstance(OllamaLMProvider, this._byokStorageService)
		);
		this.registerProvider(
			AzureBYOKModelProvider.providerName.toLowerCase(),
			this._instantiationService.createInstance(AzureBYOKModelProvider, this._byokStorageService)
		);
		this.registerProvider(
			CustomOAIBYOKModelProvider.providerName.toLowerCase(),
			this._instantiationService.createInstance(CustomOAIBYOKModelProvider, this._byokStorageService)
		);
	}

	private async registerProvidersWithKnownModelData(): Promise<void> {
		const knownModels = await this.fetchKnownModelList();
		if (this._store.isDisposed) {
			return;
		}

		this.registerProvider(
			AnthropicLMProvider.providerName.toLowerCase(),
			this._instantiationService.createInstance(AnthropicLMProvider, knownModels[AnthropicLMProvider.providerName] ?? {}, this._byokStorageService)
		);
		this.registerProvider(
			GeminiNativeBYOKLMProvider.providerName.toLowerCase(),
			this._instantiationService.createInstance(GeminiNativeBYOKLMProvider, knownModels[GeminiNativeBYOKLMProvider.providerName] ?? {}, this._byokStorageService)
		);
		this.registerProvider(
			XAIBYOKLMProvider.providerName.toLowerCase(),
			this._instantiationService.createInstance(XAIBYOKLMProvider, knownModels[XAIBYOKLMProvider.providerName] ?? {}, this._byokStorageService)
		);
		this.registerProvider(
			OAIBYOKLMProvider.providerName.toLowerCase(),
			this._instantiationService.createInstance(OAIBYOKLMProvider, knownModels[OAIBYOKLMProvider.providerName] ?? {}, this._byokStorageService)
		);
	}

	private registerProvider(providerId: string, provider: LanguageModelChatProvider<LanguageModelChatInformation>): void {
		if (this._store.isDisposed || this._providers.has(providerId)) {
			return;
		}
		try {
			this._store.add(lm.registerLanguageModelChatProvider(providerId, provider));
			this._providers.set(providerId, provider);
		} catch (error) {
			this._logService.error(error, `Failed to register the ${providerId} language model provider.`);
		}
	}

	private async fetchKnownModelList(): Promise<Record<string, BYOKKnownModels>> {
		try {
			const response = await this._fetcherService.fetch('https://main.vscode-cdn.net/extensions/copilotChat.json', { method: 'GET', callSite: 'byok-known-models' });
			const data: unknown = await response.json();
			if (data === null || typeof data !== 'object' || Array.isArray(data)) {
				this._logService.warn('BYOK: Copilot Chat known models list was not a JSON object. Defaulting to an empty list.');
				return {};
			}

			const modelList = data as { version?: unknown; modelInfo?: unknown };
			if (modelList.version !== 1 || modelList.modelInfo === null || typeof modelList.modelInfo !== 'object' || Array.isArray(modelList.modelInfo)) {
				this._logService.warn('BYOK: Copilot Chat known models list is not in the expected format. Defaulting to an empty list.');
				return {};
			}

			this._logService.info('BYOK: Copilot Chat known models list fetched successfully.');
			return modelList.modelInfo as Record<string, BYOKKnownModels>;
		} catch (error) {
			// The standalone gateway providers do not depend on this catalog. Keep
			// them available if the optional metadata endpoint is unreachable.
			this._logService.error(error instanceof Error ? error : String(error), 'BYOK: Could not fetch the shared known-model catalog. Registering other providers without its metadata.');
			return {};
		}
	}
}
