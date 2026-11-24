# Multi-agent acceptance and production certification

**Issue:** [#88](https://github.com/CoderaxAI/Coderax/issues/88)

**Source baseline:** `main@bb6227f3286e8e3fdf56a76513de68c4f3e6c93e` (2026-11-04 inspection)

**Overall status:** **NOT CERTIFIED**. A source file or deterministic test is not proof that multiple real provider generations, secure agent-to-agent messages, or deployed functionality work.

This is an **evidence ledger and executable acceptance plan**, not a claim that the seven capabilities have shipped. All release gates must remain enforced. Never replace an unverified entry with PASS because a preview is READY, a mock runs, or a PR merges.

## Seven-capability matrix

| Capability                                     | Source / implementation observation                                                                                                                                                                                                                                  | Local contract / tests                                                                                                                                               | GitHub CI  | Staging preview | Production | Certification  |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------- | ---------- | -------------- |
| 1. Multi-agent system (MAS)                    | Agent discovery, team/graph and workflow source exists under `packages/api/src/agents/`; three independently configured agents in one bounded run **not verified**                                                                                                   | `autoDelegation.spec.ts` **8/8 passed locally 2026-11-04**; `e2e/specs/mock/agent-handoffs.spec.ts` present but **not executed**; three real generations **not run** | Unverified | Unverified      | Unverified | **INCOMPLETE** |
| 2. Authenticated A2A                           | In-app run envelope (`envelope.ts`) and subagent control routing exist; a standards-compatible external authenticated message endpoint has **not** been established                                                                                                  | `e2e/specs/real/agent-handoff-mcp.spec.ts` is a source candidate, **not** executed external-protocol proof                                                           | Unverified | Unverified      | Unverified | **BLOCKED**    |
| 3. Multi-agent collaboration                   | Portfolio review workflow defines two independent read-only checks and dependent synthesis in `scripts/portfolio/registry.mjs`; real agent artifact passing not proven                                                                                               | `scripts/portfolio/registry.test.mjs` **9/9 passed locally 2026-11-04** (DAG shape only); `e2e/specs/mock/agent-collaboration-tools.spec.ts` **not executed**        | Unverified | Unverified      | Unverified | **INCOMPLETE** |
| 4. Orchestration                               | Durable workflow engine/handlers/store under `packages/api/src/workflows/`                                                                                                                                                                                           | `engine.spec.ts` **25/25** and `integration.spec.ts` **8/8 passed locally 2026-11-04**; no real provider/worker run recorded                                         | Unverified | Unverified      | Unverified | **INCOMPLETE** |
| 5. Delegation                                  | Automatic delegation and subagent source exists, with handoff UI                                                                                                                                                                                                     | `autoDelegation.spec.ts` **8/8 passed locally 2026-11-04**; permission ceiling and real separate child runs **not certified**                                        | Unverified | Unverified      | Unverified | **INCOMPLETE** |
| 6. Decentralized swarm                         | Removed 2026-11-20: the unreachable swarm coordinator, Mongo lease repository, adapter and config schema were deleted because no runtime constructed them and the explicit permission-scoped feature gate was never implemented. No swarm implementation exists in this tree. | Removed with the implementation; the 2026-11-04 local results below are historical and no longer reproducible from this tree.                                      | Unverified | Unverified      | Unverified | **INCOMPLETE** |
| 7. Bidirectional/multi-hop agent communication | Subagent control routing (steer/queue/interrupt/cancel) exists, but B→A follow-up plus B→C→A routed control with loop guards **not established**                                                                                                                     | Dedicated multi-hop idempotency, authorization and provenance test **not established**                                                                               | Unverified | Unverified      | Unverified | **BLOCKED**    |

**Meaning of the columns:** "Source exists" documents an entry point to investigate. "Unverified" means no current run-ID / exact-SHA / command output / real exchange was collected for that cell. No row is certified while staging or production is unverified. The release-gate incident is tracked in [#52](https://github.com/CoderaxAI/Coderax/issues/52); native Work's CyVox independence is tracked in [#92](https://github.com/CoderaxAI/Coderax/issues/92).

## Executed local evidence (2026-11-04)

Baseline `main@bb6227f3286e8e3fdf56a76513de68c4f3e6c93e`, which includes the merged swarm lease work from #133. Commands were run from the repository on the maintainer's Windows workstation with the repository-pinned Node/Jest versions. Counts below are the actual reported results from this baseline; they are **not** CI runs.

| Capability       | Suite                                                 | Command                                                                          | Result                           |
| ---------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------- |
| 6                | Swarm lease contract                                  | `cd packages/api && npx jest src/agents/swarm.spec.ts --ci --runInBand`          | 1 suite, **17 passed**, 0 failed |
| 1, 5             | Automatic delegation                                  | `cd packages/api && npx jest src/agents/autoDelegation.spec.ts --ci --runInBand` | 1 suite, **8 passed**, 0 failed  |
| 4                | Workflow engine                                       | `cd packages/api && npx jest src/workflows/engine.spec.ts --ci --runInBand`      | 1 suite, **25 passed**, 0 failed |
| 4                | Workflow integration                                  | `cd packages/api && npx jest src/workflows/integration.spec.ts --ci --runInBand` | 1 suite, **8 passed**, 0 failed  |
| 3                | Portfolio DAG shape                                   | `node --test scripts/portfolio/registry.test.mjs`                                | **9 passed**, 0 failed           |
| 1, 3, 4, 5, 6, 7 | Mock/real E2E, real-provider, CI, staging, production | Not executed for this evidence update                                            | **UNVERIFIED**                   |

**What this does not prove.** The swarm suites listed below were deleted on 2026-11-20 with their unreachable implementation: no runtime ever constructed `SwarmCoordinator` or the lease repository, so the historical local passes proved only an in-process contract that shipped nowhere. Their recorded results remain below as history and cannot be rerun from this tree. The delegation and workflow suites use deterministic test doubles, not three real provider generations. The portfolio suite checks DAG shape and permission metadata, not real agent artifact exchange. No CI workflow, preview deployment, or production readback was collected, so every CI/staging/production cell above remains **UNVERIFIED**.

## Post-merge local re-execution — 2026-11-04 (base `main@1ef8647`)

The Mongo suites added by #150 and the Work regressions added by #149 had been merged without execution because Actions cannot start (#141). Dependencies were installed and the suites executed locally on this base. These are real command exits, but **not** CI, staging or production evidence.

| Area | Command | Result |
| --- | --- | --- |
| Durable lease repository | `cd packages/data-schemas && npx jest src/methods/swarmLease.spec.ts --ci --runInBand` | 5 passed, 0 failed |
| Durable lease adapter | `cd packages/api && npx jest src/agents/swarmMongoStore.spec.ts --ci --runInBand` | 5 passed, 0 failed |
| In-memory lease contract | `cd packages/api && npx jest src/agents/swarm.spec.ts --ci --runInBand` | 17 passed, 0 failed |
| Work dependency guards | `cd packages/api && npx jest src/work/deps.spec.ts --ci --runInBand` | 18 passed, 0 failed |
| Conversation turn saves | `cd packages/api && npx jest src/conversations/save.spec.ts --ci --runInBand` | 24 passed, 0 failed |
| Conversation storage | `cd packages/data-schemas && npx jest src/methods/conversation.spec.ts --ci --runInBand` | 352 passed, 0 failed |
| Work chat route | `node --test api/server/routes/__tests__/workChat.test.js` | 48 passed, 0 failed |
| Work model projection | `node --test api/server/routes/__tests__/workModels.test.js` | 8 passed, 0 failed |

**Repairs required to reach those results.**

- `packages/api/src/conversations/save.spec.ts` failed 1/24 on first execution: it seeded a tenant row outside `tenantStorage`, so the tenant-isolation plugin had no scope to stamp. The test now runs inside `tenantStorage.run({ tenantId: 'tenant-a' })`, matching the request path.
- `api/server/routes/__tests__/workChat.test.js` failed 3/48: `seedWorkConversation` required the app's `~/models` alias before checking whether a conversation should be seeded, and `node:test` does not register that alias. The store lookup is now lazy.

**Boundary correction.** The Mongo collection contract and queries moved from `packages/api` to `packages/data-schemas/src/methods/swarmLease.ts`; `packages/api` then only derived the scoped key and mapped the coordinator's CAS contract. That code was removed on 2026-11-20.

**Still unverified.** The unreachable `SwarmCoordinator` was removed on 2026-11-20; capability 6 now has no implementation in this tree. No two-process peer race, restart recovery, staging run or production readback exists. `npx tsc --noEmit` in `packages/api` is clean at `e4ccd932` (2026-11-24, after building `data-provider` and `data-schemas`); the three errors recorded earlier in `src/engines/opencode/adapter.spec.ts` and the `ModeDecision` re-export no longer reproduce. GitHub Actions still fails before `Set up job` (#141). Keep every CI/staging/production cell **UNVERIFIED**.

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

### Reported local test result — 2026-11-04 (receipt missing)

PR #142 reports a local swarm test run, but does not provide the complete execution receipt required by this ledger. The following command is **reported, not independently rerun or verified here**:

```sh
cd packages/api
node ../../node_modules/jest/bin/jest.js --config jest.config.mjs src/agents/swarm.spec.ts --runInBand
```

| Evidence field | Recorded value |
| --- | --- |
| Reported outcome | 1 suite passed, 17/17 tests, 0 failed (PR #142 description; **unverified**) |
| Inspected source baseline | `main@bb6227f` — **not** proof of the tested checkout |
| Exact tested commit SHA | **NOT RECORDED** |
| Process exit status | **NOT RECORDED** (do not infer from the reported assertion count) |
| Duration | **NOT RECORDED** |
| Saved stdout/stderr or artifact URL | **NOT PROVIDED** |
| Independently verifiable local test result | **UNVERIFIED** until a complete receipt is attached |

**Next evidence action:** execute the command on the exact PR head (or record the exact tested commit), save the full output with process exit status and elapsed duration, and link a retained artifact or GitHub check run. Do not promote this reported result to a verified local PASS without that receipt. Even a verified local pass would certify only the in-process CAS lease contract, not runtime wiring, multi-replica CAS, CI, staging, production, or the other six capabilities.

Then execute the targeted integration suites in `packages/api/src/workflows/`, real agent handoff E2E, tenant-authorization negative tests, and a provider-backed staged test using approved staging credentials. Add runnable CI jobs with correct branch/path filters for new tests, without disabling existing required checks.

For **each capability and environment** capture an evidence record:

| Required field   | Record                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Source           | PR number, immutable head commit SHA, reviewed file/test paths                                                       |
| CI               | Workflow run/check name, conclusion, failing step/log link, or exact no-run blocker                                  |
| Agent identities | Redacted, distinct saved agent IDs and authorized tenant scope                                                       |
| Model            | Provider, concrete model ID, free/local availability proof; no secrets                                               |
| A2A/workflow     | Correlation ID, task/run ID, participant IDs, request/receipt/result and bounded retry history                       |
| Performance      | Raw non-sensitive timings with sample count (start, first token, completion, persistence)                            |
| Negative tests   | Unauthorized sender, cross-tenant, tool denial, recursion/replay, crash and cancellation outcomes                    |
| Staging          | URL, deployment ID, exact source SHA, actual authenticated real-provider exchange and durable reload                 |
| Production       | Canonical deployment/source readback, real Chat **and** Work runs, restart/cancel/retry observations, rollback point |

If any field is missing, keep its cell **UNVERIFIED / BLOCKED** and leave #88 open. Never record secret values, private payloads, raw session tokens, or proprietary employer resources in this document.

## Next actions by capability

1. **MAS:** run three saved agents with distinct, actually configured free/local models in one bounded run; capture agent IDs, model IDs and durable statuses.
2. **A2A:** choose and document the external protocol/endpoint, then add authenticated envelopes, replay/idempotency, tenant denial and retry tests plus a security review before exposing ingress.
3. **Collaboration:** execute `agent-collaboration-tools.spec.ts` in CI and then one real researcher/implementer/reviewer run with conflicting findings preserved.
4. **Orchestration:** run a provider-backed DAG covering parallel nodes, dependent gating, pause/cancel/retry and restart recovery; record worker execution and settled state.
5. **Delegation:** run a real saved specialist and an isolated self-subagent, then exercise permission/tool/attachment ceilings and user opt-out negatives.
6. **Swarm:** there is no implementation to wire after the 2026-11-20 removal. If the capability is revived, implement the durable repository behind an explicit permission-scoped runtime feature gate, then execute a two-process peer race, lease expiry/reassignment and duplicate-side-effect test in staging.
7. **Bidirectional:** implement routed B→A follow-up and B→C→A multi-hop with recursion guards, per-hop tenant/approval checks and idempotent receipts; prove with tests and a staged run.

## Dependencies and stop conditions

- [#52](https://github.com/CoderaxAI/Coderax/issues/52): restore real CI runner execution and validate public guest→real model→SSE→persisted conversation, with source-matched release evidence. CI failures before runner steps are not test failures and must not be bypassed.
- [#92](https://github.com/CoderaxAI/Coderax/issues/92): Work must run natively without CyVox; optional CyVox outage cannot suppress Work functionality.
- [#90](https://github.com/CoderaxAI/Coderax/issues/90): no cross-organization onboarding without explicit authorization; employer repositories stay on separate approved infrastructure; no automatic portfolio-wide model fan-out.
- [#100](https://github.com/CoderaxAI/Coderax/issues/100): The external cloud bridge is not certified without an owner-authorized endpoint and a real authenticated exchange.

**Do not release** while essential security/CI/production gates are failing or unsupported. Do not claim Codex or Copilot CLI collaboration unless distinct actual terminal/process request-response evidence exists. Reopen this ledger with recorded facts and update each cell only when that exact verification has been performed.

## Execution blockers observed — 2026-11-05

- The inspected checkout was `0db4bc5f6c8423d5dc36e9c209d426afb255221f` (planning commit; parent `59e989dd571b2e279a93fef276ee1ffd1ce5454f`). The working tree was clean before this ledger update. The root `node_modules/.bin/jest` executable was absent, so no local suite was run on this checkout.
- The Actions job cited in the #153 report (`126962715000`) could not be inspected: GitHub's job-log request returned HTTP 404. Issue [#141](https://github.com/CoderaxAI/Coderax/issues/141) records that representative jobs were rejected before runner setup with no steps because of an account billing/spending-limit block. This is a runner-startup blocker, not evidence that tests passed or failed.
- No billing, workflow, secret, or required-check setting was changed, and no CI rerun, staging deployment, or production verification was performed. Keep CI, staging, production, and all seven capability certifications **UNVERIFIED**. The next release-gate action remains owner-authorized restoration of Actions execution, followed by rerunning the required checks on the exact candidate SHA.
