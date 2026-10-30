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
- **Coding Team mode inherits the selection on the per-task contract.**
  `CoderaxAI/CyVox#38` adds `model` and `thinking_effort` to `run_team()` and
  forwards them to all three delegated `run_agent` runs (Engineering Lead,
  Software Engineer, QA Reviewer), which apply them without calling
  `ModelManager.select()`. Once that change is merged and deployed, a Team task
  runs all three agents on the selection Work submits. An older deployment
  ignores the two extra fields, so all three agents keep the deployment model
  until it ships. The Work composer states this version-conditional scope in
  Team mode.
- Thinking effort maps to a bounded decode budget (`max_tokens` and
  `temperature`) inside CyVox. It is not provider-native reasoning control.
- The existing CyVox desktop worker must be connected by the owner; a hosted
  Vercel function cannot directly operate an unpaired local computer.
- CyVox hosted temporary SQLite fallback is not durable. Computer tasks
  require durable storage; a green Vercel build is not runtime readiness.
- The Work model picker offers `cyvox/auto`, free gateway IDs
  (`openrouter/free` or IDs ending in `:free`), prefixed Ollama IDs
  (`ollama:` or `ollama/`), and raw inventory names that CyVox reports with
  `location: "OLLAMA"` and `compatible_now: true`. The bridge re-checks a raw
  name against the authenticated `/api/models` inventory before forwarding, so
  a paid gateway model stays rejected even when the inventory lists it. CyVox/
  ModelGateway still checks provider availability. Free services can have rate
  limits and data policies.
- Coderax and CyVox retain separate persistence stores and lifecycles.
- Keep both apps independently available during rollout. Disable
  `CYVOX_ADDON_ENABLED` to roll back the integration safely.
