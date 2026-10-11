/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomBytes } from 'crypto';
import { commands, Uri, Webview, WebviewView, WebviewViewProvider, window } from 'vscode';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IExtensionContribution } from '../../common/contributions';

export const extensionSettingsViewId = 'jah-copilot-chat.settings';
export const openExtensionSettingsCommandId = 'jah-copilot-chat.openSettings';

const extensionSettingsQueryPrefix = '@ext:';

interface SettingsViewMessage {
	type: 'open-settings' | 'open-chat';
}

function isSettingsViewMessage(value: unknown): value is SettingsViewMessage {
	if (typeof value !== 'object' || value === null || !('type' in value)) {
		return false;
	}
	return value.type === 'open-settings' || value.type === 'open-chat';
}

export class ExtensionSettingsViewContribution extends Disposable implements IExtensionContribution, WebviewViewProvider {
	readonly id = 'extension-settings-view';

	constructor(@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext) {
		super();
		this._register(window.registerWebviewViewProvider(extensionSettingsViewId, this, {
			webviewOptions: { retainContextWhenHidden: true }
		}));
		this._register(commands.registerCommand(openExtensionSettingsCommandId, () => this.openExtensionSettings()));
	}

	resolveWebviewView(view: WebviewView): void {
		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [Uri.joinPath(this._extensionContext.extensionUri, 'assets')]
		};
		view.webview.html = this.getHtml(view.webview);

		this._register(view.webview.onDidReceiveMessage((message: unknown) => {
			if (!isSettingsViewMessage(message)) {
				return;
			}

			if (message.type === 'open-settings') {
				void this.openExtensionSettings();
			} else if (message.type === 'open-chat') {
				void this.openChat();
			}
		}));

		let openedChatForCurrentVisibility = false;
		const openChatWhenVisible = () => {
			if (!view.visible) {
				openedChatForCurrentVisibility = false;
				return;
			}
			if (!openedChatForCurrentVisibility) {
				openedChatForCurrentVisibility = true;
				void this.openChat();
			}
		};
		this._register(view.onDidChangeVisibility(openChatWhenVisible));
		openChatWhenVisible();
	}

	private async openExtensionSettings(): Promise<void> {
		try {
			await commands.executeCommand('workbench.action.openSettings', `${extensionSettingsQueryPrefix}${this._extensionContext.extension.id}`);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			void window.showErrorMessage(`Could not open Jah Copilot Chat settings: ${detail}`);
		}
	}

	private async openChat(): Promise<void> {
		try {
			await commands.executeCommand('workbench.action.chat.open');
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			void window.showErrorMessage(`Could not open Chat: ${detail}`);
		}
	}

	private getHtml(webview: Webview): string {
		const nonce = randomBytes(16).toString('hex');
		const logoUri = webview.asWebviewUri(Uri.joinPath(this._extensionContext.extensionUri, 'assets', 'jah-copilot.png'));

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
	<title>Jah Copilot Chat</title>
	<style nonce="${nonce}">
		:root { color-scheme: light dark; }
		body {
			margin: 0;
			padding: 20px 16px 28px;
			color: var(--vscode-foreground);
			background: var(--vscode-sideBar-background);
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			line-height: 1.5;
		}
		main { max-width: 560px; margin: 0 auto; }
		header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
		.logo { width: 44px; height: 44px; object-fit: contain; border-radius: 10px; }
		.eyebrow { margin: 0 0 2px; color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
		h1 { margin: 0; font-size: 20px; font-weight: 600; }
		.card { padding: 16px; margin-bottom: 14px; border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border)); border-radius: 8px; background: var(--vscode-editor-background); }
		h2 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }
		p { margin: 0 0 14px; color: var(--vscode-descriptionForeground); }
		p:last-child { margin-bottom: 0; }
		.actions { display: flex; flex-wrap: wrap; gap: 8px; }
		button {
			min-height: 30px;
			padding: 5px 12px;
			border: 1px solid transparent;
			border-radius: 2px;
			color: var(--vscode-button-foreground);
			background: var(--vscode-button-background);
			font: inherit;
			cursor: pointer;
		}
		button:hover { background: var(--vscode-button-hoverBackground); }
		button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
		button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
		button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
		.note { font-size: 12px; }
		.note strong { color: var(--vscode-foreground); }
	</style>
</head>
<body>
	<main>
		<header>
			<img class="logo" src="${logoUri}" alt="Jah Copilot Chat logo">
			<div>
				<p class="eyebrow">Jah Copilot Chat</p>
				<h1>Chat is ready</h1>
			</div>
		</header>
		<section class="card" aria-labelledby="chat-heading">
			<h2 id="chat-heading">Chat</h2>
			<p>Open the native VS Code Chat interface with the same UI and features as GitHub Copilot Chat. Choose a provider or model from the chat model picker.</p>
			<div class="actions">
				<button id="open-chat" type="button">Open Chat</button>
			</div>
		</section>
		<section class="card" aria-labelledby="settings-heading">
			<h2 id="settings-heading">Extension settings</h2>
			<p>Open the VS Code Settings editor filtered to Jah Copilot Chat. Your changes are saved using VS Code's normal settings storage.</p>
			<div class="actions">
				<button class="secondary" id="open-settings" type="button">Open extension settings</button>
			</div>
		</section>
	</main>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		document.getElementById('open-settings').addEventListener('click', () => vscode.postMessage({ type: 'open-settings' }));
		document.getElementById('open-chat').addEventListener('click', () => vscode.postMessage({ type: 'open-chat' }));
	</script>
</body>
</html>`;
	}
}
