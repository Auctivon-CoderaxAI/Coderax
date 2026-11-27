# WorkflowEngine client contract

A client reads the contract once instead of probing routes. Every documented
capability below is served by this repository; anything absent is declared, not
guessed.

## Discovery

| Request | Response |
| --- | --- |
| `GET /api/meta` | `apiVersion`, `minimumClientVersion`, `generationProtocol`, `capabilities`, `commit`, `generatedAt` |
| Any `/api/*` response | `x-coderax-api-version: <major>` |

`GET /api/meta` is public and `no-store`. `commit` is the deployed
`BUILD_COMMIT` when the deployment exports one, otherwise `null`.

### Version negotiation

Send `x-coderax-api-version` on every request. A **mutating** request (`POST`,
`PUT`, `PATCH`, `DELETE`) that advertises a different major is refused with
`426` and `{ "code": "API_VERSION_UNSUPPORTED", "apiVersion": <server major> }`
before any handler reads its body or writes state. A missing header is treated
as a legacy client and stays accepted; a present but unparseable value is
refused, because it cannot be negotiated.

The server gains capabilities only within a major version. A breaking response
change bumps the major, which is the only signal a client needs.

## Work chat

`POST /api/work/chat` streams Server-Sent Events.

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:ba76e57fc852181fee8ffd2f7818415c86a462b7245ba8b14c1a92c767eb5486 -->

- Every complete frame carries a monotonic `id:` field. Chat reattachment does not use this ID as a cursor.
- A retried start is deduplicated. Send `Idempotency-Key: <1-128 chars of
  [A-Za-z0-9._:-]>` (or `clientRequestId` in the body); the retry resolves to the
  live generation and answers `{ "status": "resumed", "streamId": ... }` instead
  of starting a second one. A malformed key is rejected with
  `400 WORK_IDEMPOTENCY_KEY_INVALID` rather than being ignored.
- Reattach to an interrupted generation with
  `GET /api/agents/chat/stream/:streamId?resume=true`. When resume state exists,
  the sync payload contains `sync: true`, `resumeState`, and `pendingEvents`.
  Replace local state with the resume state before applying pending events.
  Without resume state, pending events are sent individually.

<!-- /coderabbit-ai-generated:v1 -->

## Workflow runs

### Owner-wide index

`GET /api/workflows/runs?workflowId=&status=&before=&limit=`

- Owner-scoped: identity comes from the authenticated request only.
- `status` is a comma-separated list of `queued`, `running`, `paused`,
  `waiting_approval`, `completed`, `failed`, `cancelled`. An unknown name is
  `400`.
- `limit` is `1-50` (default `50`). `before` is an ISO timestamp; only runs
  created strictly before it are returned.
- The response is `{ runs, nextBefore }`. `nextBefore` is `null` unless a full
  page was returned; pass it back as `before` for the next page.

A run started from the web UI is discoverable here without knowing its workflow
id. `GET /api/workflows/:id/runs` remains the per-workflow list.

### Run stream

`GET /api/workflows/runs/:runId/stream`

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:da1683cd270576949bdf88f493092e303d6862b6c1be956c61eac91e64d8fb6f -->

If retention has removed a needed event, the server sends a `replay-gap` frame without an ID, followed by the current snapshot. Replace local state with that snapshot. Otherwise the stream uses these frames:

<!-- /coderabbit-ai-generated:v1 -->

```
event: run-event
id: <runId>:<seq>
data: {"runId":"…","sequence":7,"event":{"at":"…","type":"step.completed",…}}

event: snapshot
id: <runId>:<seq>
data: {"run":{…}}
```

`seq` is assigned once when a run event is appended and is never reused, so it
remains a valid cursor after the retained log (200 events) drops its oldest
entries. A snapshot's id covers every event it already contains.

Reconnect with `Last-Event-ID: <runId>:<seq>` to receive only the events after
that sequence, in order, then the current snapshot. A cursor for another run is
ignored, which starts a fresh stream instead of replaying the wrong log.

## Repositories

No connected-repository inventory route is published.
`capabilities.repos.list` is `false`, and the reason is included in the
metadata, so a client does not call a guessed path. Automated work passes the
repository explicitly on the run body.

## Health

`GET /health`, `GET /livez` and `GET /readyz` are unauthenticated plain-text
probes (`OK` / `NOT_READY`).
