# Coderax for Visual Studio Code

This extension sends prompts to the Coderax agent API at `/api/agents/v1`. MongoDB remains behind the Coderax server; the extension never connects to Atlas and contains no database URI or database password.

## Connect

1. Set `coderax.apiBaseUrl` to the HTTPS origin for your Coderax service if the default is not the one you use.
2. Run **Coderax: Connect** and enter your Coderax account credentials. The password is sent directly to that HTTPS origin, held only for the request, and not written to settings or SecretStorage. If two-factor authentication is enabled, enter the one-time code when prompted.
3. The extension asks the authenticated server to issue an API key that expires after 30 days, verifies it against the agent-model endpoint, and stores it with VS Code `SecretStorage`.

For federated accounts, or when an API key already exists, run **Coderax: Use Existing API Key** instead. The key is validated before it is saved.

## Commands

- **Coderax: Ask an Agent** — sends a prompt to an agent available to the stored API key and opens the answer as a Markdown document.
- **Coderax: Check Connection** — verifies authenticated access to the Coderax agent API.
- **Coderax: Open Web Workspace** — opens the configured Coderax site in the system browser.
- **Coderax: Clear Local Credentials** — removes the key from VS Code SecretStorage. A key created by Connect remains valid on the server until it expires after 30 days; revoke it from the Coderax account if immediate revocation is needed.

The extension does not store passwords or API keys in VS Code settings, workspace files, logs, or source control. Network redirects are rejected so an API key cannot be forwarded to another host. Requests use the configured HTTPS origin; localhost HTTP is accepted only for local development.
