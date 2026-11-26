# WorkflowEngine gateway

Coderax reaches the WorkflowEngine through a server-side gateway. The browser
never holds an engine credential and never addresses the engine directly.

- Implementation: `packages/api/src/gateway`
- Wiring: `api/server/routes/workflowEngine.js`, mounted at `/api/workflow-engine`
- Engine contract: `Auctivon-CoderaxAI/Coderax-WorkflowEngine`, `CONTRACT_VERSION 1.0.0`

## Recovery context

Three commits reported by earlier sessions — `2c53325c` (Coderax gateway),
`185b3f1` (WorkflowEngine integration) and `d12a8b5` (CoderaxCLI integration) —
do not exist in any local Git object, reflog, dangling tree, sibling worktree,
remote branch, PR ref, or in GitHub's object store. GitHub answers
`422 No commit found` for each. They were never pushed, and no checkpoint or
recovery artifact contains them. The gateway in this repository is therefore a
fresh implementation against the current authoritative WorkflowEngine contracts,
not a restoration of those commits.

## Owner authentication

Every gateway route runs `requireJwtAuth` and then the owner gate in
`gateway/auth.ts`. A valid session is not sufficient: Coderax is owner-controlled,
so the authenticated user must hold the owner role. Identity is read from
`req.user` only; a body or query `userId` is never trusted.

The engine credential is read from the server environment variable named by
`workflowEngine.tokenEnv` (default `CODERAX_ENGINE_TOKEN`) at call time. It is
attached as an `Authorization: Bearer` header on owner operations, is absent from
public health checks, and never appears in a URL, a response, a log line or an
error. Redirects are refused.

## Transport configuration

```yaml
workflowEngine:
  enabled: false # the only switch; false answers 503 and changes nothing else
  baseURL: https://engine.example
  tokenEnv: CODERAX_ENGINE_TOKEN
  contractVersion: 1.0.0
  requestTimeoutMs: 30000
  streamIdleTimeoutMs: 120000
```

`baseURL` must be https unless it points at loopback. A path prefix is preserved.
The transport is reversible: disabling the gateway removes the proxy surface and
leaves every existing Coderax route untouched. No data migration is involved and
no engine state is deleted.

## Handshake and fail-closed behavior

Before the first proxied request for a transport, the gateway reads `/v1/health`
and refuses traffic unless:

- `contractVersion` equals the pinned `workflowEngine.contractVersion`;
- the engine status is not `failed`;
- no required health check is `failed`.

`prewarm` performs the same check at startup without a request. A failed check
leaves every gateway route answering 503 with a stable code; it never falls back
to another engine and never weakens the check to keep serving.

Capabilities are reported separately (`durable`, `cancellation`, `resume`,
`streaming`). A Work operation whose capability the engine does not advertise is
refused with `WORKFLOW_ENGINE_UNSUPPORTED` instead of degrading silently.

## Routes

| Gateway route                                  | Engine operation                                               |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `GET /contract`                                | pinned and served contract versions, capabilities              |
| `GET /health`, `GET /ready`                    | `/v1/health`, `/v1/ready`                                      |
| `GET /agents`, `GET /models`                   | `/v1/agents`, `/v1/models`                                     |
| `POST /chat`                                   | `/v1/chat` — JSON reply, or SSE frames when the engine streams |
| `POST /work`                                   | `/v1/work` — 202 with task id and generation                   |
| `GET /tasks/:taskId`                           | `/v1/work/{taskId}`                                            |
| `POST /tasks/:taskId/cancel`                   | cancellation, generation-fenced by the engine                  |
| `POST /tasks/:taskId/resume`                   | resume from checkpoint                                         |
| `POST /tasks/:taskId/retry`                    | same-engine retry                                              |
| `GET /tasks/:taskId/events?after=N`            | replay from `N`, then tail, as SSE                             |
| `GET /tasks/:taskId/permissions`               | pending and decided permission requests                        |
| `POST /tasks/:taskId/permissions`              | approve or deny one request                                    |
| `GET /tasks/:taskId/artifacts`                 | artifact metadata from task status                             |
| `GET /conversations`, `GET /conversations/:id` | conversation discovery                                         |
| `GET /memory?mode=private\|cloud`              | owner-scoped memory                                            |
| `GET /notifications`                           | durable completion notifications and unread count              |

`GET /tasks` answers 501: contract 1.0.0 has no task-list operation. Task
discovery is conversation discovery followed by one task by id. Artifact
_content_ is likewise unavailable in 1.0.0; the metadata route says so instead of
inventing a download endpoint.

## Typed validation and streaming

Requests are validated against the contract schemas before dispatch. Responses
and every SSE frame are validated after receipt; a shape the contract does not
describe is a `protocol_error`, not a value passed to a client. Event streams are
deduplicated by `eventId`, reject `seq <= lastDelivered`, and resynchronise from
the exact last delivered sequence when a gap or an unterminated close appears.
A stream that cannot be resynchronised fails closed.

## Single-authoritative-engine rule

The gateway runs no engine and owns no execution state. It records no
conversation, task or event, and it does not write to Coderax data. Every control
operation carries the engine's fencing generation, and the engine's lease is the
only authority for which process may write a task. Consequently the gateway
cannot create a second authoritative engine for a conversation: it forwards the
owner's request to the one engine that holds the lease, or reports the engine's
refusal.

## Cutover blockers

This change is the gateway only. Production cutover stays blocked until, in the
engine repository and its own PRs:

1. persistent execution events and replay across restart are verified;
2. catalog parity is verified (agents, models, zero-cost routing);
3. conversation projections are verified (same transcript after reload);
4. end-to-end tests run against a deployed engine.

Until then `workflowEngine.enabled` remains false in production configuration and
no client route is switched. Existing Coderax Chat and Work behavior is unchanged.

## Coordination

`client/**`, `worker/**`, `wrangler.jsonc` and `packages/api/src/engines/**` are
not modified by this change, per the WorkflowEngine migration plan while PRs #308
and #309 are unresolved. The gateway is additive: one route mount and one
configuration field.
