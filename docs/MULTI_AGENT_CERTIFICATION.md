# Multi-agent acceptance and production certification

**Issue:** [#88](https://github.com/CoderaxAI/Coderax/issues/88)  
**Source baseline:** `main@bb6227f` (2026-11-04 inspection)

**Overall status:** **NOT CERTIFIED**. A source file or deterministic test is not proof that multiple real provider generations, secure agent-to-agent messages, or deployed functionality work.

This is an **evidence ledger and executable acceptance plan**, not a claim that the seven capabilities have shipped. All release gates must remain enforced. Never replace an unverified entry with PASS because a preview is READY, a mock runs, or a PR merges.

## Seven-capability matrix

| Capability | Source / implementation observation | Local contract / tests | GitHub CI | Staging preview | Production | Certification |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Multi-agent system (MAS) | Agent discovery, team/graph and workflow source exists under `packages/api/src/agents/`; independently configured three-agent run **not verified** | `packages/api/src/agents/autoDelegation.spec.ts`; `e2e/specs/mock/agent-handoffs.spec.ts` exist; three real generations **not run** | Unverified | Unverified | Unverified | **INCOMPLETE** |
| 2. Authenticated A2A | In-app handoff code exists; a standards-compatible external authenticated message endpoint has **not been established** | `e2e/specs/real/agent-handoff-mcp.spec.ts` is a source candidate, **not** executed external-protocol proof | Unverified | Unverified | Unverified | **BLOCKED** |
| 3. Multi-agent collaboration | Portfolio review workflow defines two independent read-only checks and dependent synthesis in `scripts/portfolio/registry.mjs`; real agent artifact passing not proven | `scripts/portfolio/registry.test.mjs` tests DAG shape; `e2e/specs/mock/agent-collaboration-tools.spec.ts` exists | Unverified | Unverified | Unverified | **INCOMPLETE** |
| 4. Orchestration | Durable workflow engine/handlers/store under `packages/api/src/workflows/` | `packages/api/src/workflows/engine.spec.ts`, `integration.spec.ts` and other tests exist; no current executed results recorded | Unverified | Unverified | Unverified | **INCOMPLETE** |
| 5. Delegation | Automatic delegation and subagent source exists, with handoff UI | `packages/api/src/agents/autoDelegation.spec.ts`, `e2e/specs/mock/agent-handoffs.spec.ts` exist; permission ceiling and real separate child runs not certified | Unverified | Unverified | Unverified | **INCOMPLETE** |
| 6. Decentralized swarm | `packages/api/src/agents/swarm.ts` adds a CAS lease coordinator: peer claiming, duplicate prevention, expiry/reassignment, attempt caps, stale-owner fencing and tool ceilings. It is not wired into Chat/Work and must be explicitly constructed; no runtime feature flag exists yet | `packages/api/src/agents/swarm.spec.ts` — 17/17 local tests pass (2026-11-04); config schema covers lease defaults/bounds. Runtime wiring, multi-replica CAS, staging and production peer tests **not established** | Unverified | Unverified | Unverified | **INCOMPLETE** |
| 7. Bidirectional/multi-hop agent communication | Existing handoffs do not by themselves establish B→A follow-up plus B→C→A routed control with loop guards | Dedicated multi-hop idempotency, authorization and provenance test **not established** | Unverified | Unverified | Unverified | **BLOCKED** |

**Meaning of the columns:** "Source exists" documents an entry point to investigate. "Unverified" means no current run-ID / exact-SHA / command output / real exchange was collected for that cell. No row is certified while staging or production is unverified. The release-gate incident is tracked in [#52](https://github.com/CoderaxAI/Coderax/issues/52); native Work's CyVox independence is tracked in [#92](https://github.com/CoderaxAI/Coderax/issues/92).

## Required acceptance scenarios

Each scenario must use **three distinct, configured agents** (researcher, implementer, reviewer) unless the capability explicitly requires more, and preserve tenant/tool permissions, model identity, trace IDs, abort and retry semantics. Use a free/local provider only when **actually configured, reachable and owner-authorized**; do not incur paid inference or substitute mocks for real-provider proof.

1. **MAS:** Create three separately saved specialists, check authorization before each run, dispatch a bounded shared task, observe three distinct provider generations and durable independent statuses. Reject an unconfigured or paid model.
2. **A2A:** Exchange typed request → accepted → progress → result/error envelopes with sender, recipient, tenant, task ID, correlation ID, idempotency key and expiry. Prove authenticated sender verification, replay rejection, cross-tenant denial, disconnect/retry and cancellation. Identify the protocol and implementation endpoint exactly; **in-app callbacks do not prove external A2A interoperability**.
3. **Collaboration:** Have a researcher produce source-labeled evidence, an implementer propose a bounded change, and a separate reviewer independently disagree/approve. Preserve artifacts and conflicting findings; a final synthesis must not expose hidden reasoning or silently execute forbidden actions.
4. **Orchestration:** Verify two independent DAG nodes can run concurrently and dependent nodes wait. Exercise approval pauses, event ordering, stale completions, restart recovery, timeout, cancellation cascades and settled durable states. Record actual model/worker execution, not only the definition.
5. **Delegation:** Verify distinct saved specialist and isolated self-subagent; test child tool, workspace and attachment ceilings, denied MCP permissions, depth and fan-out limits, user opt-out, abort and audit provenance. No child may broaden parent permissions.
6. **Swarm:** Feature-gate a decentralized peer queue/lease protocol; two peers race for one item, only one claim wins, expired claims are reassigned, retries cannot double-apply a side effect and all participants terminate deterministically within TTL and spend limits. An orchestrator fanning out tasks does not satisfy this item.
7. **Bidirectional:** Demonstrate A→B request/result, B→A follow-up request/result, and B→C→A multi-hop within one audited run. Reject recursion loops and duplicate side effects. Check every hop's tenant scope and approvals, not just the root request.

## Verification commands and evidence

Run these on the **exact PR head SHA** after dependency installation; record the command, exit status, assertion/test counts, duration, and artifact or check-run URL. They are **proposed commands, not commands executed while creating this document**:

```sh
node --test scripts/portfolio/registry.test.mjs
npm run build:packages
npm run test:packages:api
npm run test:api
npm run e2e:mock
```

### Executed local evidence — 2026-11-04

The only capability with a recorded local run is swarm:

```sh
cd packages/api
node ../../node_modules/jest/bin/jest.js --config jest.config.mjs src/agents/swarm.spec.ts --runInBand
```

Result: **1 suite passed, 17/17 tests, 0 failed**. This certifies the in-process CAS lease contract only. It does **not** establish runtime wiring, multi-replica CAS, CI, staging, production, or the other six capabilities.

Then execute the targeted integration suites in `packages/api/src/workflows/`, real agent handoff E2E, tenant-authorization negative tests, and a provider-backed staged test using approved staging credentials. Add runnable CI jobs with correct branch/path filters for new tests, without disabling existing required checks.

For **each capability and environment** capture an evidence record:

| Required field | Record |
| --- | --- |
| Source | PR number, immutable head commit SHA, reviewed file/test paths |
| CI | Workflow run/check name, conclusion, failing step/log link, or exact no-run blocker |
| Agent identities | Redacted, distinct saved agent IDs and authorized tenant scope |
| Model | Provider, concrete model ID, free/local availability proof; no secrets |
| A2A/workflow | Correlation ID, task/run ID, participant IDs, request/receipt/result and bounded retry history |
| Performance | Raw non-sensitive timings with sample count (start, first token, completion, persistence) |
| Negative tests | Unauthorized sender, cross-tenant, tool denial, recursion/replay, crash and cancellation outcomes |
| Staging | URL, deployment ID, exact source SHA, actual authenticated real-provider exchange and durable reload |
| Production | Canonical deployment/source readback, real Chat **and** Work runs, restart/cancel/retry observations, rollback point |

If any field is missing, keep its cell **UNVERIFIED / BLOCKED** and leave #88 open. Never record secret values, private payloads, raw session tokens, or proprietary employer resources in this document.

## Dependencies and stop conditions

- [#52](https://github.com/CoderaxAI/Coderax/issues/52): restore real CI runner execution and validate public guest→real model→SSE→persisted conversation, with source-matched release evidence. CI failures before runner steps are not test failures and must not be bypassed.
- [#92](https://github.com/CoderaxAI/Coderax/issues/92): Work must run natively without CyVox; optional CyVox outage cannot suppress Work functionality.
- [#90](https://github.com/CoderaxAI/Coderax/issues/90): no cross-organization onboarding without explicit authorization; employer repositories stay on separate approved infrastructure; no automatic portfolio-wide model fan-out.
- [#100](https://github.com/CoderaxAI/Coderax/issues/100): The external cloud bridge is not certified without an owner-authorized endpoint and a real authenticated exchange.

**Do not release** while essential security/CI/production gates are failing or unsupported. Do not claim Codex or Copilot CLI collaboration unless distinct actual terminal/process request-response evidence exists. Reopen this ledger with recorded facts and update each cell only when that exact verification has been performed.
