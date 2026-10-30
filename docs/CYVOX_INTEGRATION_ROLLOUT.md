# Coderax ↔ CyVox staged integration

The Coderax UI is the primary chat/work surface; CyVox is independently
deployable for Robot, computer use, delegated work and diagnostics.

## Private configuration (not checked into Git)

Configure the connection once in **Settings → Coderax Work** as an administrator
with config access (or `manage:configs:cyvox`). The service URL is an origin only,
and the access token is encrypted at rest and never returned to the browser.
Use **Test connection** before enabling the integration.

Deployment environment variables remain a fallback for deployments that manage
configuration outside the app:

- `CYVOX_ADDON_ENABLED=true`
- `CYVOX_BASE_URL=https://<your-CyVox-backend>` (origin only, no path)
- `CYVOX_AUTH_TOKEN=<owner's CyVox backend bearer token>`

A saved connection takes precedence over these variables, so disabling it in
Settings does not silently re-enable the environment connection. Never expose the
CyVox token to the frontend or to unauthenticated guests. The proxy rejects
remote targets without HTTPS and a token.

## Release and checks

1. Deploy **preview only**. Verify Coderax backend routing, authorized admin
   access, `/api/cyvox/readiness`, `/api/cyvox/models` and `/api/cyvox/tasks`.
2. Verify CyVox database readiness is **durable**, inference is available,
   and an authorized local desktop worker is online before trying Robot actions.
3. Confirm that guests cannot read/write remote CyVox resources.
   Each state-changing action requires administrator role and an explicit
   `X-CyVox-Confirm: yes` header set after UI confirmation.
4. Run API unit tests, client typecheck/build, Robot negative tests, and
   a safe test task with an approval checkpoint.
5. Confirm the emergency-stop and give-control-back paths. Confirm that
   production never forwards billed model IDs via the free-only selector.
6. Do not merge or deploy to production without the owner's review.

## Limitations

- The integrated Work screen requests CyVox's per-task `FAST` routing policy.
  Fast selection is a policy preference, **not a latency guarantee**.
- Work sends a per-task `model` and `thinking_effort`, and never calls the
  deployment-global `/api/models/select` for task configuration. An older CyVox
  ignores the two extra fields, so per-task selection only takes effect once
  `CoderaxAI/CyVox#38` is merged and deployed. Until then a task runs on the
  deployment default.
- **Coding Team mode does not inherit the selection.** `cyvox/ai_team.py`
  `run_team()` accepts no model or effort, and its three delegated `run_agent`
  calls omit both, so the lead, engineer and reviewer all run on the deployment
  model. The Work composer says so when Team mode is selected. propagation is
  a separate CyVox change: accept both in `run_team()`, forward them to every
  delegated `run_agent` call, and pass them through from the caller that reaches
  `run_team`.
- Thinking effort maps to a bounded decode budget (`max_tokens` and
  `temperature`) inside CyVox. It is not provider-native reasoning control.
- The existing CyVox desktop worker must be connected by the owner; a hosted
  Vercel function cannot directly operate an unpaired local computer.
- CyVox hosted temporary SQLite fallback is not durable. Computer tasks
  require durable storage; a green Vercel build is not runtime readiness.
- Only `cyvox/auto`, `openrouter/free`, IDs ending in `:free`, and Ollama
  local model IDs (`ollama:` or `ollama/`) are selectable from the integrated
  Work controls. CyVox/ModelGateway still checks provider availability. Free
  services can have rate limits and data policies.
- Coderax and CyVox retain separate persistence stores and lifecycles.
- Keep both apps independently available during rollout. Disable
  `CYVOX_ADDON_ENABLED` to roll back the integration safely.
