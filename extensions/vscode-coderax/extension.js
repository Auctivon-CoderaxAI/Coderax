'use strict';

const vscode = require('vscode');
const {
  DEFAULT_BASE_URL,
  askAgent,
  createApiKey,
  getModels,
  loginWithPassword,
  normalizeBaseUrl,
  revokeApiKey,
  verifyTotp,
} = require('./client');

const API_KEY_SECRET = 'coderax.apiKey';
const API_KEY_ID_STATE = 'coderax.apiKeyId';
const API_KEY_EXPIRY_STATE = 'coderax.apiKeyExpiresAt';
const API_KEY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function serviceOrigin() {
  const configured = vscode.workspace.getConfiguration('coderax').get('apiBaseUrl', DEFAULT_BASE_URL);
  return normalizeBaseUrl(configured);
}

function setStatus(item, value, tooltip) {
  item.text = value;
  item.tooltip = tooltip;
  item.show();
}

async function selectModel(models) {
  const configured = vscode.workspace.getConfiguration('coderax').get('defaultModel', '').trim();
  const selected = models.find((model) => model.id === configured);
  if (selected) return selected;
  if (models.length === 1) return models[0];
  return vscode.window.showQuickPick(
    models.map((model) => ({
      label: model.name || model.id,
      description: model.id,
      model,
    })),
    { placeHolder: 'Choose a Coderax agent' },
  ).then((choice) => choice?.model);
}

async function connectWithExistingKey(context, statusItem) {
  const apiKey = await context.secrets.get(API_KEY_SECRET);
  if (!apiKey) return false;
  try {
    const models = await getModels(serviceOrigin(), apiKey);
    setStatus(statusItem, '$(check) Coderax', 'Connected to Coderax API');
    const expiry = context.globalState.get(API_KEY_EXPIRY_STATE);
    const expiryText = expiry ? ` The local API key expires ${new Date(expiry).toLocaleDateString()}.` : '';
    const modelText = models.length ? ` ${models.length} agent${models.length === 1 ? '' : 's'} available.` : ' The key is valid; no agents are currently available to it.';
    vscode.window.showInformationMessage(`Connected to Coderax.${modelText}${expiryText}`);
    return true;
  } catch (error) {
    if (error?.status === 401) {
      await context.secrets.delete(API_KEY_SECRET);
      await context.globalState.update(API_KEY_ID_STATE, undefined);
      await context.globalState.update(API_KEY_EXPIRY_STATE, undefined);
      return false;
    }
    throw error;
  }
}

async function createAndStoreApiKey(context, statusItem) {
  const email = await vscode.window.showInputBox({
    title: 'Connect to Coderax',
    prompt: 'Coderax account email',
    ignoreFocusOut: true,
  });
  if (!email) return;

  let password = await vscode.window.showInputBox({
    title: 'Connect to Coderax',
    prompt: 'Password is sent only to the configured Coderax HTTPS service and is not saved.',
    password: true,
    ignoreFocusOut: true,
  });
  if (!password) return;

  const origin = serviceOrigin();
  let login;
  try {
    login = await loginWithPassword(origin, email.trim(), password);
  } finally {
    // Keep account passwords only for the active login request.
    password = '';
  }

  if (login.twoFASetupRequired) {
    throw new Error('This account must finish two-factor enrollment in the Coderax web app before connecting the extension.');
  }
  if (login.twoFAPending && typeof login.tempToken === 'string') {
    const code = await vscode.window.showInputBox({
      title: 'Two-factor verification',
      prompt: 'Enter the current Coderax authenticator code or backup code.',
      password: true,
      ignoreFocusOut: true,
    });
    if (!code) return;
    login = await verifyTotp(origin, login.tempToken, code.trim());
  }
  if (typeof login.token !== 'string' || login.token.length < 20) {
    throw new Error('Coderax did not issue a usable session. Check the account, password, and any two-factor code.');
  }

  const expiresAt = new Date(Date.now() + API_KEY_TTL_MS).toISOString();
  const issued = await createApiKey(origin, login.token, expiresAt);
  if (typeof issued.key !== 'string' || typeof issued.id !== 'string') {
    throw new Error('Coderax did not return an API key. Check that this account can use remote agents.');
  }

  try {
    const models = await getModels(origin, issued.key);
    await context.secrets.store(API_KEY_SECRET, issued.key);
    await context.globalState.update(API_KEY_ID_STATE, issued.id);
    await context.globalState.update(API_KEY_EXPIRY_STATE, issued.expiresAt || expiresAt);
    setStatus(statusItem, '$(check) Coderax', 'Connected to Coderax API');
    const modelText = models.length ? ` ${models.length} agent${models.length === 1 ? '' : 's'} available.` : ' No remote agents are currently available to this account.';
    vscode.window.showInformationMessage(`Coderax connected. A 30-day API key is stored in VS Code SecretStorage.${modelText}`);
  } catch (error) {
    // If validation or local secret storage fails, revoke the just-created key while the
    // short-lived user token is still in memory, avoiding an orphaned credential.
    try {
      await revokeApiKey(origin, login.token, issued.id);
    } catch {
      // The server-side key has a 30-day expiry even if immediate cleanup is unavailable.
    }
    await context.secrets.delete(API_KEY_SECRET).catch(() => {});
    await context.globalState.update(API_KEY_ID_STATE, undefined).catch(() => {});
    await context.globalState.update(API_KEY_EXPIRY_STATE, undefined).catch(() => {});
    throw error;
  }
}

async function activate(context) {
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  statusItem.command = 'coderax.checkConnection';
  setStatus(statusItem, '$(plug) Coderax', 'Check Coderax connection');
  context.subscriptions.push(statusItem);

  context.subscriptions.push(vscode.commands.registerCommand('coderax.connect', async () => {
    try {
      if (await connectWithExistingKey(context, statusItem)) return;
      await createAndStoreApiKey(context, statusItem);
    } catch (error) {
      setStatus(statusItem, '$(warning) Coderax', 'Connection failed. Run Coderax: Check Connection for details.');
      vscode.window.showErrorMessage(error.message || 'Could not connect to Coderax.');
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('coderax.useApiKey', async () => {
    const apiKey = await vscode.window.showInputBox({
      title: 'Use Existing Coderax API Key',
      prompt: 'Paste an API key created by your Coderax account. It will be tested and stored in VS Code SecretStorage.',
      password: true,
      ignoreFocusOut: true,
    });
    if (!apiKey) return;
    try {
      const models = await getModels(serviceOrigin(), apiKey.trim());
      await context.secrets.store(API_KEY_SECRET, apiKey.trim());
      await context.globalState.update(API_KEY_ID_STATE, undefined);
      await context.globalState.update(API_KEY_EXPIRY_STATE, undefined);
      setStatus(statusItem, '$(check) Coderax', 'Connected to Coderax API');
      vscode.window.showInformationMessage(`Connected to Coderax. ${models.length} agent${models.length === 1 ? '' : 's'} available.`);
    } catch (error) {
      vscode.window.showErrorMessage(error.message || 'Could not validate that Coderax API key.');
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('coderax.checkConnection', async () => {
    const apiKey = await context.secrets.get(API_KEY_SECRET);
    if (!apiKey) {
      setStatus(statusItem, '$(plug) Coderax', 'No Coderax API key stored');
      vscode.window.showInformationMessage('Coderax is not connected. Run Coderax: Connect or Use Existing API Key.');
      return;
    }
    try {
      const models = await getModels(serviceOrigin(), apiKey);
      setStatus(statusItem, '$(check) Coderax', 'Connected to Coderax API');
      vscode.window.showInformationMessage(`Coderax API is reachable and authenticated. ${models.length} agent${models.length === 1 ? '' : 's'} available.`);
    } catch (error) {
      setStatus(statusItem, '$(warning) Coderax', 'Connection check failed');
      vscode.window.showErrorMessage(error.message || 'Could not connect to Coderax.');
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('coderax.askAgent', async () => {
    const apiKey = await context.secrets.get(API_KEY_SECRET);
    if (!apiKey) {
      vscode.window.showInformationMessage('Connect to Coderax first.');
      return;
    }
    const prompt = await vscode.window.showInputBox({
      title: 'Ask a Coderax Agent',
      prompt: 'Enter your prompt. It will be sent to the Coderax service configured in Settings.',
      ignoreFocusOut: true,
    });
    if (!prompt?.trim()) return;
    try {
      const origin = serviceOrigin();
      const models = await getModels(origin, apiKey);
      if (!models.length) throw new Error('No remote agents are available to this API key.');
      const model = await selectModel(models);
      if (!model) return;
      const response = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Asking ${model.name || model.id}…`, cancellable: false },
        () => askAgent(origin, apiKey, model.id, prompt.trim()),
      );
      const document = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: `# Coderax response\n\n${response}\n`,
      });
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (error) {
      vscode.window.showErrorMessage(error.message || 'Coderax could not complete the request.');
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('coderax.openWorkspace', async () => {
    try {
      await vscode.env.openExternal(vscode.Uri.parse(`${serviceOrigin()}/`));
    } catch (error) {
      vscode.window.showErrorMessage(error.message || 'Could not open the Coderax workspace.');
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('coderax.disconnect', async () => {
    await context.secrets.delete(API_KEY_SECRET);
    await context.globalState.update(API_KEY_ID_STATE, undefined);
    await context.globalState.update(API_KEY_EXPIRY_STATE, undefined);
    setStatus(statusItem, '$(plug) Coderax', 'No Coderax API key stored');
    vscode.window.showInformationMessage('The API key was removed from VS Code SecretStorage. Any server-side key created by Connect remains valid until its 30-day expiry; revoke it from the Coderax account if immediate revocation is needed.');
  }));

}

function deactivate() {}

module.exports = { activate, deactivate };
