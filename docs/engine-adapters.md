# Coding-agent engines and Cloud Power Mode

Coderax keeps one Chat/Work interface and one task lifecycle. Two optional
coding-agent engines sit behind a common adapter contract, and Cloud Power Mode
is a separate inference path for the one owner account.

Nothing in this document changes Coderax into a multi-tenant product: there are
no signups, subscriptions, billing, or customer features. Both engines and Cloud
Power Mode are disabled by default.

## What is implemented

| Piece                  | Location                                                          | Behavior                                                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adapter contract       | `packages/api/src/engines/types.ts`                               | Normalized `started`, `text_delta`, `tool_call`, `tool_result`, `file_edit`, `approval_required`, `usage`, `completed`, `failed`, `cancelled` events; typed failures |
| One-run arbitration    | `packages/api/src/engines/arbiter.ts`                             | A task key can be held by exactly one engine; a second engine gets `busy`                                                                                            |
| Workspace confinement  | `packages/api/src/engines/workspace.ts`                           | Real-path checks inside the mode root; private and cloud roots must not overlap; symlink escapes are rejected                                                        |
| Shared settlement      | `packages/api/src/engines/run.ts`                                 | Timeout, cancellation and stream loss settle once; a stream ending without a terminal event is a failure                                                             |
| OpenCode adapter       | `packages/api/src/engines/opencode/`                              | Official `@opencode-ai/sdk` client over an operator-run `opencode serve`; session create, prompt, SSE events, abort                                                  |
| OpenHands adapter      | `packages/api/src/engines/openhands/`                             | Remote Agent Server transport with Agent Server event mapping; typed refusal when no server/client exists                                                            |
| Engine registry        | `packages/api/src/engines/registry.ts`                            | Default-engine selection, fail-closed availability, lease release                                                                                                    |
| Config service         | `packages/api/src/engines/service.ts`                             | Reads `engines` config, loads the SDK only when enabled, produces safe status                                                                                        |
| Read route             | `GET /api/work/engines`                                           | Availability of each engine and why it cannot run; no paths or credentials                                                                                           |
| Owner Work ingress     | `packages/api/src/engines/workChat.ts`                            | ADMIN-only `POST /api/work/chat` branch; streams and persists the turn, holds one live run per conversation, and reuses Work cancellation; off by default            |
| Private/cloud boundary | `packages/api/src/cloud/mode.ts`                                  | Cross-mode denial, owner check, single-use export approval bound to exact content                                                                                    |
| Secret scrubbing       | `packages/api/src/cloud/redact.ts`                                | Provider keys, bearer tokens and sensitive env values removed from outbound text and logs                                                                            |
| GroqCloud provider     | `packages/api/src/cloud/groq.ts`                                  | One allowlisted free model, explicit free-tier attestation, local daily budget, 429/402 fail closed, no tools                                                        |
| Config                 | `engines`, `cloudPower` in `packages/data-provider/src/config.ts` | Disabled defaults, bounded timeouts and budgets                                                                                                                      |

## OpenCode (primary engine)

Verify of the official package (2026-11-17):

- `@opencode-ai/sdk` **1.19.6**, **MIT**, ESM-only, exports `createOpencodeClient` and `createOpencodeServer`.
- It talks to an OpenCode server. Coderax **attaches** to an existing server; it
  does not spawn one, which keeps API memory flat on small Oracle Always Free
  ARM64 instances. The server is the operator's process and its workspace.
- Node `require(esm)` support (Node >= 22.12) is required by the CommonJS API
  package. Older runtimes receive a typed `sdk_unavailable` failure.

Owner setup (no cost):

```bash
# on the host that owns the workspace
npm install -g opencode-ai
opencode serve --hostname 127.0.0.1 --port 4096
```

```yaml
engines:
  defaultEngine: opencode
  workspaces:
    privateRoot: /srv/coderax/private
    cloudRoot: /srv/coderax/cloud
  opencode:
    enabled: true
    baseURL: http://127.0.0.1:4096
    timeoutMs: 900000
  workChat:
    enabled: true
    engine: opencode
```

The adapter creates a session, subscribes before prompting, streams SDK events,
maps tool and file evidence, and aborts on cancellation. A run that produces
text but no terminal event is reported as `protocol_error`.

### Owner-only Work ingress

`engines.workChat.enabled` is a separate opt-in from `engines.opencode.enabled`.
When both are on, an authenticated `ADMIN` who starts a turn without a saved
agent or attachments is routed through OpenCode at `POST /api/work/chat`:

- the turn uses the private workspace root only, never the cloud root;
- the user and assistant messages are written to the existing Work conversation,
  and its `workState` becomes `completed`, `failed` or `cancelled`;
- the reply streams as the same `created` / text / `final` SSE frames the Work
  client already consumes;
- `/api/work/tasks/:id/cancel` cancels the live engine run, scoped to the same
  user and tenant;
- a second run for the same conversation is refused with `WORK_ENGINE_BUSY`.

Every non-owner, every selected-agent turn, and every attachment stays on the
native runner. If OpenCode requests a tool permission that Work cannot collect,
the run is cancelled and reported as failed rather than silently approved.
Attachments, regenerate, compact and edit turns are rejected by this branch.

## OpenHands (optional engine)

Verified surface (2026-11-17):

- `openhands-sdk` **1.62.0** on PyPI, Python **>= 3.12**; the canonical SDK and
  Agent Server are Python.
- `@openhands/typescript-client` **1.59.0** is the official TypeScript client,
  but it is marked **alpha**, browser-compatible, and supports **remote
  conversations only**.

Coderax therefore does **not** bundle or spawn a Python runtime. The adapter is
implemented against a remote Agent Server transport, is disabled by default, and
returns `not_configured` until an owner supplies `agentServerUrl` and a client
transport. This is a genuine blocker, not simulated support: the API process
must not silently start a Python agent on a 24 GB ARM instance.

## GroqCloud (inference only)

Verified free-tier facts (2026-11-17, official rate-limit page):

- `openai/gpt-oss-120b` is on the **Free plan** at 30 RPM, 1,000 requests/day,
  8,000 tokens/minute and 200,000 tokens/day.
- Groq has both Free and billable Developer plans, and an API key does not reveal
  the organisation's plan. Coderax therefore requires an explicit owner
  attestation (`acknowledgeFreeTierOnly`) and keeps local budgets at or below
  the published free ceilings.
- The existing zero-cost router still blocks Groq for the _automatic_ free
  route, because that path cannot verify the account plan. Cloud Power Mode is a
  separate, owner-only, explicit-export path; it does not weaken that router.

```yaml
cloudPower:
  enabled: true
  provider: groq
  model: openai/gpt-oss-120b
  acknowledgeFreeTierOnly: true
  maxRequestsPerDay: 200
  maxTokensPerDay: 200000
  requestTimeoutMs: 60000
```

`GROQ_API_KEY` is read server-side from the environment only. The provider never
returns it, logs it, or places it in a request body.

## Private/Cloud isolation

These are enforced in backend code:

1. **No cross-mode access.** A cloud actor cannot name a private conversation,
   workspace, memory, embedding, index, tool output, log or credential, and a
   private actor cannot name a cloud resource.
2. **Owner only.** Every actor must carry `isOwner`; an internal caller cannot
   bypass this.
3. **Explicit export approval.** A cloud payload needs a single-use approval
   token bound to the owner, the exact content hash and a short expiry. Private
   entries are refused before a token is issued.
4. **No textual bypass.** Prompt-injection text is treated as data. It cannot
   change a source classification or attach a private resource.
5. **Separate workspaces.** Engine workspaces resolve inside the root for their
   mode; overlapping roots are a configuration error.
6. **Fail closed.** Private mode is refused in the Groq preflight before any
   network call, including timeout and error paths. There is no fallback.
7. **Scrubbed output.** Sensitive env values and recognizable key formats are
   removed from outbound messages and log text.

## Cost and infrastructure

- No paid model, GPU, domain or provider upgrade is configured. Groq is the only
  external inference provider in this path and only its free model is accepted.
- The local ledger caps requests and tokens per UTC day. It is process-local, so
  Groq's 429 remains the final authority; a 429 stops the turn and never retries
  against a paid route.
- OpenCode attaches to an operator server instead of spawning it, and OpenHands
  is not bundled, so no Python runtime or GPU process is started by Coderax.
- Credentials stay in the server environment; no secret is committed.

## Verification performed

```bash
cd packages/api
npx jest --runInBand --coverage=false src/engines src/cloud
npx tsc --noEmit
npx tsdown
```

The focused Work ingress suite additionally covers the owner/flag gate, native
fallback, streamed and persisted turns, bounded follow-up context, busy and
disabled failures, unsupported attachments, and approval fail-closed behavior.

The focused suites cover:

- a real disposable workspace: failing `node --test`, a real file edit, a real
  passing rerun, mapped tool and file evidence (no model credential is claimed);
- cancellation, timeout settlement, stream loss, and a second engine refused
  while the first holds the task;
- workspace traversal, symlink escape and overlapping roots;
- OpenCode event parsing including cumulative text, tool success/error, file
  deduplication and abort;
- OpenHands disabled/not-configured behavior and event mapping;
- cloud cross-mode retrieval, non-owner access, approval binding, single use,
  expiry and prompt injection;
- Groq private-mode refusal, missing attestation, model allowlist, tool refusal,
  429 without retry, local budget exhaustion, secret scrubbing and SSE parsing.

## Known limitations

1. **No live OpenCode or OpenHands server or model credential was available in
   this environment.** The adapters and owner ingress are exercised against
   protocol-conformant transports; a live model run is not claimed.
2. **The owner ingress is text-only.** Attachments, regenerate, compact and edit
   turns stay on the native path or are rejected; a saved-agent selection always
   stays native. There is no engine picker UI: the owner enables the branch in
   `coderax.yaml`.
3. **OpenCode tool approvals fail closed.** The Work client does not yet collect
   an OpenCode permission request, so such a run is cancelled and reported as
   failed rather than approved automatically.
4. **OpenHands cannot be enabled without a remote Agent Server and the alpha
   TypeScript client.** The adapter stays disabled rather than faking support.
5. **The Groq daily ledger is process-local.** It is a guard, not a distributed
   billing guarantee; exhaustion still fails closed through Groq's 429.
