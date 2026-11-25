# Freebuff Cloud authenticated task bridge: source review

**Tracking:** [#100](https://github.com/CoderaxAI/Coderax/issues/100)  
**Review date:** 2026-11-03  
**Disposition:** **NO DOCUMENTED, OWNER-AUTHORIZED DIRECT FREEBUFF CLOUD TASK BRIDGE IDENTIFIED IN THE OFFICIAL PUBLIC SOURCES REVIEWED.** This is an evidence gap, not a claim that Freebuff can never offer a private integration.

## Official public materials inspected

| Source | What the source actually documents | What it does **not** establish |
| --- | --- | --- |
| [Freebuff product README](https://github.com/CodebuffAI/freebuff/blob/main/README.md) | Freebuff Cloud operates agents on connected GitHub repositories. CLI, Desktop, Web, Chat and Cloud are distinct product surfaces. | No public, authenticated Cloud API for an independent application to create a task, poll/stream status or fetch a result. |
| [`@codebuff/sdk` README](https://github.com/CodebuffAI/freebuff/blob/main/sdk/README.md) | `CodebuffClient({ apiKey, cwd })`, `client.run({agent, prompt, handleEvent})`, bounded `maxAgentSteps`, and `previousRun` continuation; local/runtime client events include agent/tool lifecycle, text and errors. | Not a documented Freebuff **Cloud** job submission endpoint; no Cloud task ID, tenant/identity binding, Cloud cancellation or retry/resume protocol is established. An SDK API key is not a consented Cloud-repository grant. |
| [Official repository contribution guidance](https://github.com/CodebuffAI/freebuff/blob/main/CONTRIBUTING.md) | Public repository is an export/mirror; backend, database, billing and deployment source are not part of accepted public contribution scope. | Absence of a Cloud API in exported source **cannot prove** no private backend or partner API exists. |

**Boundary:** The SDK `run()` call and its returned run state are a **different integration contract** from a remotely managed, authenticated Freebuff Cloud task/result service. Never represent GitHub issue comments, copied prompts or branch/PR handoffs as an actual direct A2A exchange.

## Task/correlation interface evidence

| Requirement | Publicly source-supported finding | Status |
| --- | --- | --- |
| Invocation & authentication | SDK has an explicitly supplied Codebuff API key and local/client execution context; Freebuff Cloud advertises GitHub connection | **Cloud task API not documented** |
| Task and correlation IDs | SDK `previousRun` is session continuation state, not a Cloud task receipt | **Not established** |
| Progress and completion | SDK `handleEvent` callback exposes events during SDK runs | **Cloud event endpoint not established** |
| Errors, retries, deadlines | SDK run result can indicate success/error; `maxAgentSteps` bounds steps | **Cloud retries and timeout contract not established** |
| Cancellation and disconnect recovery | No verified public Cloud task cancellation, reconnect, checkpoint or idempotency contract in the materials above | **Not established** |
| Tenant identity and approval | SDK key and local tool definitions do not prove Coderax user/tenant identity, tool grants or action approvals will be preserved through Cloud | **Not established** |
| Auditable live round trip | No owner-authorized Cloud identity, task API credentials or sanitized receipt/result ID connected to this review | **NOT EXECUTED** |

## Admission checklist for a future bridge

Do not add a Cloud integration or send Coderax repository content until **all** of the following are met:

1. Obtain the **official** supported authenticated Cloud task API/SDK contract and written permission for this account/use case. Record precise documentation/version and whether API access has any billable charges; never turn on paid usage by default.
2. Bind an owner-approved Cloud repository installation to an explicit authorized GitHub organization/repository and tenant. Reject cross-tenant/hostile callbacks; do not reuse personal GitHub access for employer work or distribute unrestricted PATs.
3. Define typed task IDs, correlation IDs, sender/recipient/tenant, idempotency keys, expiry, cancellation, bounded retry/recovery, status transitions, error schema, receipt signatures or equivalent integrity protections, and per-action tool approval routing.
4. Prove a **sanitized live round trip** against a disposable, nonsecret, synthetic test repository first: authenticated request → accepted task ID → status/event(s) → result/error → follow-up/abort/readback. Record exact command/API version, approved repository scope, source SHA, transaction trace IDs and timestamps; redact secrets.
5. Deny unauthenticated callbacks, replayed/mismatched tenant messages, dangerous shell/tool requests and unapproved repository writes; verify model and per-task cost limits. Maintain Cloud as optional, never a dependency for native Coderax Work ([#92](https://github.com/CoderaxAI/Coderax/issues/92)).
6. Review source, tests, CI and release evidence independently before enabling any production bridge. GitHub Actions runner failures under [#52](https://github.com/CoderaxAI/Coderax/issues/52) remain an independent release gate.

**Current next step:** Request the supported Cloud task interface and appropriate identity/consent documentation from Freebuff, or use the independently documented `@codebuff/sdk` only through a separately reviewed, owner-authorized integration with its own cost and tool-permission controls. This document does not install, execute or connect either product.

## Execution ledger

- Coderax source code: **not changed** for Freebuff integration.
- GitHub/Freebuff authentication: **no new connections made**.
- Freebuff CLI, Freebuff Cloud and Codebuff SDK: **not executed**.
- Actual A2A request/result: **not established**.
- Billing, credentials, repository permissions, model/tool access: **unchanged**.
- [#100](https://github.com/CoderaxAI/Coderax/issues/100) remains **open** pending an authorized Cloud reviewer and live evidence if a supported interface is made available.
