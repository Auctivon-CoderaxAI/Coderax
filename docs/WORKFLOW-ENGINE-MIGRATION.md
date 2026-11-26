# WorkflowEngine: authoritative backend and migration boundary

`Auctivon-CoderaxAI/Coderax-WorkflowEngine` is the designated authoritative execution platform for the
consolidated Coderax ecosystem. `Auctivon-CoderaxAI/Coderax` stays the web client (Chat and Work
surfaces) and `Auctivon-CoderaxAI/CoderaxCLI` the terminal client. The engine owns Native
intelligence, agent selection, planning and execution, durable state, model routing, permissions,
events and health; it owns no chat interface.

The `packages/api/src/engines` and `packages/api/src/workflows` code inside Coderax is the **legacy
engine** that serves production today. It is a migration dependency, not the final authority. It
keeps serving every existing conversation, project, memory and schedule until a replacement
capability passes the parity gates below.

## Verified state (2026-11-26)

Read from the repositories, not inferred from a green build.

| Fact                     | Value                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Engine `main`            | `808dfd3797`, merge of `feat/workflow-engine-foundation` (#1)                                                             |
| Published contract       | `CONTRACT_VERSION 1.0.0` at `/v1`; `openapi.json` and a drift gate exist                                                  |
| Engine deployment        | **None.** `deploy/README.md` states the repository has no deployment; it has only run locally                             |
| Durable persistence      | Lease store and fencing are implemented; task, conversation, memory, event and notification stores are **in-memory only** |
| MongoDB lease table      | Selected by `persistence.driver=mongo`, startup fails without a reachable collection, **not live-verified**               |
| External agents          | OpenCode and FreeBuff are contract-and-isolation stubs; the transport is injected, not implemented                        |
| Coderax gateway          | PR #319 adds an owner-authenticated server-side proxy pinned to contract `1.0.0` at `808dfd3`; it is **open**, not merged |
| Client and CLI migration | Not started in either client                                                                                              |

## Capability ledger

Every capability the migration must cover, mapped to the branch or pull request that owns it. "Claimed"
means the code exists on a branch; it does not mean it is reviewed, merged, deployed or parity-tested.

| Capability                           | Owner in the engine repository                         | State                                                       |
| ------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------- |
| Native reasoning                     | #3 `feat/native-reasoning-planner`                     | Open PR                                                     |
| Chat and Work surfaces               | Coderax gateway #319 + engine contracts                | Gateway open PR; engine contract 1.0.0                      |
| Durable execution and events         | #5 `feat/execution-supervisor`; `feat/durable-events*` | PR #5 open; event durability on branches, no PR             |
| Persistent memory                    | #2 intelligence core; `feat/persistent-records`        | Memory split exists; stores in-memory; branch has no PR     |
| Scheduling                           | #9 `feat/durable-scheduling`                           | Open PR                                                     |
| Notifications                        | none                                                   | In-memory persistence only; no owner branch                 |
| Durable artifacts                    | `feat/durable-artifacts`, `feat/artifact-intelligence` | Branches only; no PR                                        |
| Multimodal intelligence              | `feat/multimodal-intelligence-core`                    | Branch only; no PR                                          |
| Creative productivity intelligence   | `feat/multimodal-creative-intelligence`                | Branch only; no PR                                          |
| Cloud browser and computer use       | none                                                   | Parity row 45: not started in either engine                 |
| Native Game Studio                   | `feat/native-game-studio-gaming-agent`                 | Branch only; no PR                                          |
| Native Gaming Agent                  | same branch                                            | Branch only; no PR                                          |
| Multi-agent orchestration            | #8 `feat/native-team-orchestration`                    | Open PR                                                     |
| CoderaxCLI                           | `Auctivon-CoderaxAI/CoderaxCLI`                        | Consumes the deployment's OpenAPI; SDK switch is a later PR |
| Shared contract for all of the above | #7 `contract/authoritative-v1.1`                       | Open PR: one versioned 1.1.0 surface, SDK artifact, harness |

## Integration sequence

Order is constrained by contracts, not by preference. Each step lands on `main` behind its own
review, and the previous step stays authoritative until the next one is verified in production.

1. Land #7. One contract version and one SDK artifact are the precondition for every other step;
   without it the gateway and the clients pin different surfaces.
2. Rebase Coderax #319 onto that contract. The gateway is the only sanctioned path from the browser
   to the engine: it authenticates the owner, resolves the transport from server configuration, holds
   the engine bearer token server-side and refuses redirects. No engine credential reaches a client.
3. Land #5, #2, #3, #4 and #9 in whatever order their reviews allow. Execution supervision and
   reasoning are the pair that makes Work trustworthy; scheduling is last because a durable timer over
   an in-memory store is not durable.
4. Land #8 only after single-agent execution is stable, because team orchestration multiplies every
   execution defect.
5. Switch CoderaxCLI from discovered OpenAPI paths to the SDK. It is small and independent, and it
   validates that the contract is usable by a second client.
6. Deploy the engine next to the existing backend, then cut over capability by capability.

## Single-authority dispatch

Two engines must never receive the same conversation or task. The rule is mechanical:

- Exactly one component owns dispatch for a given route. Today it is Coderax's legacy engine.
- The gateway is the only component allowed to call the engine. No client, job or adapter calls the
  engine directly, and no background worker drains a queue on both sides.
- A capability moves by moving its route: the legacy path is removed from the dispatch table in the
  same change that adds the engine path, behind the existing owner authentication.
- The migration never writes to Coderax data from the engine repository. There are no dual writers.
- If a rollback returns a route to the legacy engine, the engine path for that route is disabled in
  the same change. Both are never enabled at once.

## Native independence

Coderax Native is the default agent and stays governed by Coderax's own reasoning, execution,
permissions, memory and model-routing architecture. The restored OpenCode service in
`deploy/oci/compose.yaml` is an **optional external runtime** on a private network with no published
port, no default selection and no path from Native execution to it. FreeBuff is optional in the same
way. Availability of either proves nothing about Native readiness, and a Native Work request must
never silently fall back to an external agent: selection is explicit, labelled, authorized and
isolated, and an unavailable engine is reported rather than substituted.

## Deployment shape (no new infrastructure, $0)

The target is the existing authorized Oracle Always Free instance that already runs the Coderax API
and Caddy. No new provider, paid tier or trial is introduced, and no Vercel dependency is added.

| Component   | Target                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| Engine      | A private Compose service on the engine network, loopback-only, unreachable from the internet                           |
| Ingress     | The existing Caddy front door; the engine port is never published                                                       |
| Database    | The existing authorized MongoDB deployment; engine lease collection is separate and prefixed                            |
| Workspaces  | Two absolute, non-overlapping directories, sharing the app's private and cloud roots only where a capability needs them |
| Credentials | Owner token and inference key supplied by the host's secret mechanism, never the repository                             |
| Worker      | The existing `coderax` Worker forwards `/v1` engine routes to the engine host behind the same proxy secret              |

The engine refuses to start until the owner identity and token, both workspace roots, a verified
zero-cost model route and a heartbeat interval at most one third of the lease TTL are all valid. A
startup that cannot satisfy them must fail loudly rather than serve a degraded engine.

## Parity gates before the legacy engine is retired

A capability is migrated only when all of these hold on the deployed origin, not in a test harness:

1. The same conversation renders and persists across a browser refresh and a second client.
2. Owner-only access is enforced at the engine boundary, and an anonymous request is refused.
3. A cancelled run terminates, a stale run is retired as interrupted, and a resumed run cannot
   overwrite a newer generation.
4. Events replay after a process restart with no duplicate or reordered delivery.
5. Schedules survive a restart and fire once, not twice, with one authority.
6. Memory and artifacts are readable after a database reconnect.
7. The Worker's `/api/config`, `/readyz` and one streamed Work reply all succeed through the canonical
   origin.

Until every applicable gate passes for a capability, the legacy engine keeps that route.

## Blockers

- The engine has never been deployed. Nothing in the repository is running in production.
- Persistent stores beyond leases are in-memory; scheduling and events cannot be certified on them.
- Cloud browser and computer use are not started in either engine.
- The Coderax Worker returns `503` on every API route, so no gateway, engine or client check can be
  performed through the canonical origin until the two Worker bindings are set.
- The Oracle origin is not recorded in any repository, and `DeploymentPlatformAI/DeploymentPlatform`
  is not readable, so the engine's host cannot be verified without owner access.
- PRs #7, #5, #2, #3, #4, #8 and #9 are open with no merge, and Coderax #319 is open. No capability is
  authoritative until its contract lands.
