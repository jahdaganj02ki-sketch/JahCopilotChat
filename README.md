<p align="center">
  <img src="assets/jah-copilot.png" alt="Jah Copilot Chat logo" width="180" />
</p>

# Jah Copilot Chat (Unofficial)

A community-maintained, MIT-licensed fork of [Microsoft's `vscode-copilot-chat`](https://github.com/microsoft/vscode-copilot-chat) (upstream snapshot: `5863f5a7088958050792b5dccbe8b46c6e13eccc`). It retains the upstream VS Code chat extension code and adds free-model catalogs and API-key providers to the model picker.

This project is not affiliated with, endorsed by, or supported by GitHub, Microsoft, Kilo, Kiro, Amazon Web Services, Cline, 9Router, or any provider named in this README.

## Added model providers

| Provider | Model discovery | Free-model handling | API key |
| --- | --- | --- | --- |
| **Google Gemini** (already integrated) | Native [Google GenAI](https://ai.google.dev/gemini-api/docs/models) model catalog | No free-only filter; account availability, quotas, and billing are controlled by Google | Google Gemini API key |
| **Groq** | [`https://api.groq.com/openai/v1/models`](https://console.groq.com/docs/api-reference#models-list) | Live catalog; non-chat models such as Whisper are excluded. No free-only filter | Groq API key |
| **Cloudflare Workers AI** | Account-scoped [Models Search API](https://developers.cloudflare.com/api/resources/ai/subresources/models/methods/search/) filtered to Text Generation; inference uses Cloudflare's [OpenAI-compatible API](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/) | Shows text-generation models; no free-only filter. Chat Completions compatibility varies by model | Cloudflare account ID and API token with Workers AI Read and Run permissions |
| **ZenMux** | [`https://zenmux.ai/api/v1/models`](https://zenmux.ai/docs/api/openai/openai-list-models.html) | Live OpenAI-compatible catalog; no free-only filter | ZenMux API key |
| **OpenAI Compatible** | Optional `<base URL>/models` discovery, or add models manually | Bring any OpenAI-compatible chat endpoint; configure capabilities per model | Optional API key, depending on the endpoint |
| **OpenCode Zen** | `https://opencode.ai/zen/v1/models` | Shows free/zero-cost OpenAI Chat Completions and Responses models, plus `big-pickle`; routes Responses models to `/responses`. Anthropic/Google/System One models are not exposed through this OpenAI-family chat provider | OpenCode Zen key for inference; public catalog discovery is attempted without a key |
| **OpenRouter** | `https://openrouter.ai/api/v1/models?supported_parameters=tools` | Filters to `:free` models, zero-priced models, and the `openrouter/free` router | OpenRouter key for inference; catalog discovery is public |
| **NVIDIA NIM** | `https://integrate.api.nvidia.com/v1/models` | Intersects the live model list with explicitly free catalog metadata and a small maintained Free Endpoint allowlist (NIM's `/models` response does not include prices) | NVIDIA API key |
| **Kilo Gateway** | `https://api.kilo.ai/api/gateway/models` | Shows explicitly zero-priced/free catalog entries and always includes `kilo-auto/free` | Optional for documented free access; add a Kilo key if required by your account or limits |
| **Kiro AI (Experimental)** | Live `ListAvailableModels` catalog via the Amazon Q runtime | Not a free-model integration; model access depends on your Kiro plan | Kiro API key (secret) and AWS region; unofficial runtime transport adapted from 9Router |
| **Cline** | Not registered: no supported public free-model catalog is available to this fork | Cline's documented free promotions are not exposed through its public API | Use the official Cline IDE/CLI for those promotions |

OpenCode Zen's `/models` response lists model IDs without API-format metadata. The Zen provider maps IDs using the [official model/endpoint table](https://opencode.ai/docs/zen/); unknown formats are not assumed to be OpenAI-compatible.

### Kilo Code OpenAI-compatible presets

These named presets use the shared OpenAI Chat Completions transport rather than Kilo Code's provider-specific SDKs or auth flows. They request `<base URL>/models` for discovery and send chats to `<base URL>/chat/completions`; the **Base URL** can be overridden in provider settings. Cloud providers require their API key. Atomic Chat and LM Studio do not require a key, and their localhost endpoints are contacted only after you explicitly configure a Base URL. Model availability and capabilities come from each API catalog; no preset applies a free-only filter.

| Provider | VS Code vendor ID | Suggested base URL |
| --- | --- | --- |
| Atomic Chat | `atomic-chat` | `http://127.0.0.1:1337/v1` |
| Cerebras | `cerebras` | `https://api.cerebras.ai/v1` |
| Chutes | `chutes` | `https://llm.chutes.ai/v1` |
| DaoXE | `daoxe` | `https://daoxe.com/v1` |
| DeepInfra | `deepinfra` | `https://api.deepinfra.com/v1/openai` |
| DeepSeek | `deepseek` | `https://api.deepseek.com/v1` |
| Eden AI | `edenai` | `https://api.edenai.run/v3` |
| Fireworks AI | `fireworks-ai` | `https://api.fireworks.ai/inference/v1` |
| LLMGateway | `llmgateway` | `https://api.llmgateway.io/v1` |
| LM Studio | `lmstudio` | `http://127.0.0.1:1234/v1` |
| Mistral AI | `mistral` | `https://api.mistral.ai/v1` |
| Mixlayer | `mixlayer` | `https://mixlayer.ai/v1` |
| Moonshot AI | `moonshotai` | `https://api.moonshot.ai/v1` |
| Nebius Token Factory | `nebius` | `https://api.tokenfactory.nebius.com/v1` |
| Perplexity | `perplexity` | `https://api.perplexity.ai` |
| Poolside | `poolside` | `https://inference.poolside.ai/v1` |
| Synthetic | `synthetic` | `https://api.synthetic.new/openai/v1` |
| Together AI | `togetherai` | `https://api.together.xyz/v1` |
| TrustedRouter | `trustedrouter` | `https://api.trustedrouter.com/v1` |
| v0 by Vercel | `v0` | `https://api.v0.dev/v1` |
| Venice AI | `venice` | `https://api.venice.ai/api/v1` |
| Vercel AI Gateway | `vercel` | `https://ai-gateway.vercel.sh/v1` |

The `/models` endpoint must return an OpenAI-style model list. Providers requiring different headers, catalog formats, API protocols, or native cloud authentication (for example Bedrock and Vertex) are intentionally not represented by these presets and are reserved for the native-integration stage. For an unlisted service or an API without model discovery, use **OpenAI Compatible** and configure models manually.

Catalogs and provider quotas change over time. Free access is subject to each provider's terms, rate limits, availability, and data-handling policies. Check a provider's official catalog before sending sensitive data.

### Kiro experimental integration and risk notice

The Kiro entry follows the API-key route in [9Router](https://github.com/decolua/9router): it discovers models with `ListAvailableModels` and sends chat requests to the regional Amazon Q runtime using Kiro's AWS EventStream protocol. This is an **unofficial, experimental runtime integration**, not a documented general-purpose Kiro chat API. Kiro's [authentication](https://kiro.dev/docs/getting-started/authentication/) and [headless CLI](https://kiro.dev/docs/cli/headless/) documentation describe API keys for the CLI and eligible paid plans; they do not promise third-party support for this provider. 9Router itself marks its Kiro provider deprecated and warns about possible account restrictions for unsupported proxy use. This fork supports API-key mode only (no Kiro OAuth/session-token import or CLI credential reuse). The runtime may change or stop working, and account or terms-related consequences are possible. Use it only if your Kiro plan and applicable terms allow it; the integration is not endorsed or supported by Kiro or AWS.

### Cline free-model limitation

[Cline's free-model documentation](https://docs.cline.bot/getting-started/free-models) states that its promotions are available in the official Cline IDE extension and CLI, but **not through the public Cline API**. Cline's API documentation does not provide this fork with a verified way to discover and call those promotions. This fork therefore does not display a Cline model-provider entry that would be misleading or non-functional. To use Cline's free promotions, use the official Cline extension or CLI; a Cline provider can be reconsidered if Cline documents supported public API access to free models.

## Using the added models

1. Build and install the extension (instructions below).
2. Open VS Code Chat and open the model picker / **Configure Models**.
3. Select the provider, configure its API key where required (plus the Cloudflare account ID for Workers AI), then choose a listed model.
4. Reopen the picker after changing provider credentials so the model list can refresh.

For an unlisted service, choose **OpenAI Compatible**. Enter its base URL and, if needed, an API key; the provider discovers models from `<base URL>/models` and sends chat requests to `<base URL>/chat/completions` (it adds `/v1` when the URL has no version suffix). If the service does not expose `/models`, leave Base URL blank and add model IDs, endpoint URLs, token limits, and capabilities in the `models` configuration array.

The added providers register independently of GitHub Copilot sign-in. Other upstream Copilot Chat features still follow their upstream authentication and availability requirements. Provider API keys are user credentials; do not put them in source files or commit them.

## VS Code, Remote and GitHub Codespaces

The extension declares `extensionKind: ["workspace"]`, so its Node extension host runs beside the workspace: locally for a local folder, and in the Codespace for both a GitHub Codespaces window and a VS Code Remote window connected to a Codespace. Provider HTTP requests, API keys in `SecretStorage`, and any `127.0.0.1`/`localhost` endpoints are therefore on the Codespace side in remote sessions; localhost does **not** mean the user's desktop.

| Environment | Runtime location | Supported workflow |
| --- | --- | --- |
| VS Code on a local folder | Local Node extension host | Install the VSIX and launch VS Code Insiders with the proposed API enabled, or use the extension development host. |
| VS Code connected to a Codespace | Codespace Node extension host | Open the repository in an Insiders remote window; use **F5 → Launch Copilot Extension**, or install the VSIX into the Codespace from the Extensions view. |
| GitHub Codespaces in a browser | Codespace Node extension host | Open this repository as a Codespace and use **F5 → Launch Copilot Extension** when the Codespaces editor build exposes the required proposed APIs. |

### Important API availability limit

This fork depends on VS Code proposed APIs (including the language-model provider API). VS Code documents proposed APIs as development-only and available in the Insiders distribution; extensions using them cannot be published to the Marketplace. A normal installed extension in stable VS Code or the stable Codespaces browser editor is therefore **not a supported deployment**. The repository cannot unlock those APIs with a workspace setting or a devcontainer option; supporting stable Codespaces as an installed product would require replacing the proposed APIs with stable APIs when available, or official host allowlisting. Use VS Code Insiders for the local and desktop-Remote workflows, or run the project in an Insiders extension development host. Do not treat a successful compile as proof that the stable Codespaces web host will expose those APIs.

## Build from source

Requirements are listed in `package.json` (currently Node.js 22.14 or newer, npm 9 or newer, and VS Code 1.115 or newer; runtime use of proposed APIs requires VS Code Insiders).

```sh
npm ci
npm run compile
npm run package
```

Install the generated VSIX from the Extensions view, selecting the Codespace/remote target when connected remotely, or install it locally with:

```sh
code-insiders --install-extension jah-copilot-chat-0.44.0.vsix
```

Then start VS Code Insiders with the extension's proposed APIs enabled (close existing windows first so this flag applies to the active process):

```sh
code-insiders --enable-proposed-api=jahdaganj02ki-sketch.jah-copilot-chat .
```

For development in Codespaces, open this repository in the Codespace, run `npm ci` and `npm run compile`, then select **F5 → Launch Copilot Extension**. The launch profile enables the proposal for the extension development host. A standard stable Codespaces web session cannot be made to accept these proposed APIs by this project alone.

### Download the GitHub Actions VSIX

The **Build VSIX** workflow runs on pushes, pull requests, and manual dispatch. Open the workflow run in GitHub Actions and download its `jah-copilot-chat-vsix-…` artifact. The workflow packages the production build but does not publish it to the Marketplace; install the downloaded VSIX through the VS Code Insiders Extensions view, choosing the Codespace target for a remote window.

## License and attribution

Upstream source and its Microsoft copyright notices are retained. See [`LICENSE.txt`](LICENSE.txt) for the MIT license. New fork-specific files are also MIT-licensed.
