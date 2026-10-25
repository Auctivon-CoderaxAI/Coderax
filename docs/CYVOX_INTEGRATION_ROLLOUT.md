# Coderax ↔ CyVox staged integration

The Coderax UI is the primary chat/work surface; CyVox is independently
deployable for Robot, computer use, delegated work and diagnostics.

## Private configuration (not checked into Git)

Configure the **Coderax backend** environment:
- `CYVOX_ADDON_ENABLED=true`
- `CYVOX_BASE_URL=https://<your-CyVox-backend>` (origin only, no path)
- `CYVOX_AUTH_TOKEN=<owner's CyVox backend bearer token>`

Never expose the CyVox token to the frontend or to unauthenticated guests.
The proxy rejects remote targets without HTTPS and a token.

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
- Model selection through CyVox currently updates shared runtime settings,
  not a per-task model parameter. Do not change the model during another run.
- The existing CyVox desktop worker must be connected by the owner; a hosted
  Vercel function cannot directly operate an unpaired local computer.
- CyVox hosted temporary SQLite fallback is not durable. Computer tasks
  require durable storage; a green Vercel build is not runtime readiness.
- Only compatible free remote models and local model names are selectable
  from the integrated Work controls; actual provider availability is checked
  by CyVox/ModelGateway. Free services can have rate limits and data policies.
- Coderax and CyVox retain separate persistence stores and lifecycles.
- Keep both apps independently available during rollout. Disable
  `CYVOX_ADDON_ENABLED` to roll back the integration safely.
