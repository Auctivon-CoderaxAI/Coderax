# Autonomous build engine

**Status:** backend foundation. It compiles a validated build plan into an ordinary Coderax
workflow, which the existing durable workflow engine executes with real agent turns. It does not
yet generate plans from a model request, expose a build route, or deploy anything.

The engine is deliberately built above the workflow engine rather than beside it. Leases, retries,
cancellation, checkpoint recovery, parallel turn dispatch and the approval pause already live in
`packages/api/src/workflows/`; duplicating them would create a second runner with a second set of
bugs.

## Why this layer exists

Work today runs one saved agent on one conversation. A project request needs more: a dependency
graph, specialist roles, a time policy, independent review, real test/build evidence, and a report
that separates finished work from claimed work. Those are the pieces in `packages/api/src/autobuild/`.

| Module       | Responsibility                                                                         |
| ------------ | -------------------------------------------------------------------------------------- |
| `plan.ts`    | Validates untrusted planner output, resolves dependencies, layers the DAG, assesses it |
| `modes.ts`   | Turbo 15 / autonomous / verified policies, complexity heuristics, honest degradation   |
| `compile.ts` | Compiles a plan into the existing workflow contract with evidence-bearing instructions |
| `report.ts`  | Derives verified, unverified, unfinished and blocked work from run state plus evidence |
| `metrics.ts` | Aggregates the benchmark dimensions and compares a candidate against a baseline        |

## Modes

| Mode         | Target              | Max tasks | Parallel | Required gates                 | Deployment |
| ------------ | ------------------- | --------- | -------- | ------------------------------ | ---------- |
| `turbo15`    | Verified MVP in 15m | 8         | 4        | tests, build, review           | Never      |
| `autonomous` | Acceptance criteria | 20        | 4        | tests, build, review           | Never      |
| `verified`   | Correctness first   | 25        | 2        | tests, build, review, security | Never      |

Turbo is a target, not a promise. `chooseEffectiveMode()` moves an oversized or complex plan to
`autonomous` and returns the reason. The report records the missed target; it never skips a gate to
meet it. No mode authorizes a deployment, and no mode lowers the evidence requirement to pass. A
plan that asks for security work, or claims it in an acceptance criterion, additionally requires the
security gate even when its mode's base gates omit it.

## Plan contract

A task must state what completion will be judged on. An instruction without acceptance criteria is
rejected before any model is called.

```ts
{
  name: 'Build the billing service',
  request: 'Build a billing service with an API, database, tests and review.',
  tasks: [
    {
      id: 'research',
      title: 'Inspect the repository',
      role: 'research',
      instruction: 'Find the existing billing, database and test patterns. Cite files.',
      acceptance: ['The findings name the files to change'],
      dependsOn: [],
    },
    {
      id: 'implement',
      title: 'Implement the service',
      role: 'backend',
      instruction: 'Implement the accepted design.',
      acceptance: ['The API rejects unauthenticated requests', 'Focused tests pass'],
      dependsOn: ['research'],
    },
    {
      id: 'verify',
      title: 'Verify independently',
      role: 'testing',
      instruction: 'Run the focused and integration tests. Report exact commands and output.',
      acceptance: ['Every command and exit status is recorded'],
      dependsOn: ['implement'],
    },
  ],
}
```

`parseBuildPlan()` rejects duplicate ids, unknown or self dependencies, cycles, unknown roles,
missing acceptance criteria and plans beyond the workflow step limit. Omitted `dependsOn` follows
the previous task; an explicit empty list makes independent roots that can run in parallel.

## Compiling to a run

```ts
const parsed = parseBuildPlan(untrustedPlannerOutput);
if (!parsed.ok) {
  return parsed.error;
}
const compiled = compileBuildPlan({
  plan: parsed.value,
  mode: chooseEffectiveMode({ requested: 'turbo15', plan: parsed.value }).mode,
  orchestratorAgentId: 'saved-agent-id',
  roleAgents: { backend: 'backend-agent-id', testing: 'testing-agent-id' },
  repository: { owner: 'owner', name: 'repo', baseRef: 'main' },
});
```

Each compiled step carries its acceptance criteria, the mode guidance, the pull-request rule and
the evidence rule. A role with no bound agent runs on the orchestrator and is listed in
`unresolvedRoles`, so a missing specialist is visible rather than silently invented.

## Report rules

`summarizeBuild()` is the anti-fabrication boundary:

- A completed turn is not a completed task without retained evidence.
- A completed run is not a verified build while a required gate is `not_run` or `failed`.
- A plan with a security task, or a plan-specific gate list, requires the security gate; a supplied gate that failed blocks verification even when the mode would not have required it.
- A skipped, cancelled or failed task makes the result `partial` or `blocked`, never complete.
- A reviewable pull request is part of delivery; missing, closed or pending-CI pull requests keep
  the result unverified.
- Turbo is met only by a `verified_complete` result that settled inside the deadline. A fast
  unverified run is not a turbo success.

The report lists `finished`, `unfinished`, `blocked`, `unverified`, `missingGates`, `blockers` and
the turbo reason, so an operator can see exactly what remains.

## Benchmarks

`summarizeBenchmarks()` reports end-to-end duration, verified completion rate, first-pass test
success, repair iterations, manual interventions, security findings, model latency and the
15-minute MVP rate. `compareBenchmarks()` separates improvements from regressions and reports
`mixed` instead of hiding one behind the other. These are pure aggregations: the samples must come
from actual runs, not from estimates.

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:58c41275235f37cff6db5396379d46c1f6524596ad2c8ef952f08edb7a7ab4aa -->

## Verification runner

`runBuildVerification({ workspaceRoot, commands, env, signal })` executes commands instead of assuming a
pass. It validates every executable against an allowlist, rejects executable paths, resolves `cwd`
with symlinks and rejects paths outside the workspace, spawns with `shell: false` on POSIX (on
Windows a shell resolves `.cmd` shims only when the arguments are restricted to shell-safe tokens),
enforces a timeout with a process-tree kill and a bounded cleanup wait, bounds and redacts output, and converts exit codes into
`BuildGateEvidence`. `tests`, `build` and `security` are executable gates; `review` remains a
judgement. A gate with no configured command is `not_run`, never `passed`. The resulting evidence is
accepted by `summarizeBuild`.

Pass an explicit job environment with the toolchain variables and any credentials authorized for that
job. A custom runner is responsible for its own execution environment. If a working directory no
longer resolves within the workspace before a command starts, verification stops and returns
`invalid_command` without passing gate evidence. Directory checks are not a sandbox; an isolated
job environment must contain workspace code and clean up any remaining descendants.

## Planner adapter and launch path

`planBuild()` accepts an injected completion function. It rejects a planner marked `paid`, extracts
JSON from fenced or conversational output, validates the object with `parseBuildPlan`, retries with
the validation message, restores the original request, chooses the effective mode and compiles the
workflow. `createHeuristicBuildPlan()` is the deterministic zero-cost fallback when no free or local
completion is configured.

`POST /api/workflows/builds` accepts a project request, mode and saved orchestrator agent, validates
the request, compiles a deterministic plan, authorizes every bound agent, then creates and starts the
ordinary durable workflow. The Workflows view has a **New autonomous build** launcher; on success it
selects the created workflow so the existing run panel and stream monitor it.

The UI sends a UUID launch key and reuses it when retrying unchanged launch inputs. The API scopes it
to the user and tenant. A retry completes a partial launch or returns the existing run; using the
same key with different inputs returns a conflict. Legacy requests that omit the key retain their
original create-on-submit behavior. The compiler includes a full long request in every step and
rejects the launch before persistence if an instruction exceeds the workflow limit.

<!-- /coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:eb8ff3c4323415cd33cf54b63b97c83cbe6d53835e4ac2fe317b9d4830e4e855 -->

## Verification of persisted runs

New build runs store the effective mode and required gates captured when they are launched.
`summarizeWorkflowBuild(run, evidence)` reads those stored requirements from the run view.
The workflow engine's `completed` status means the steps settled; the report is the enforcement
point for verified completion and rejects missing gate evidence. Older runs without a stored build
policy do not have a persisted build verification report.

## Not implemented in this change

- **Automatic verification invocation is not wired into the workflow runner.** A caller must
  collect the gate evidence and pass it to the report. Step completion does not supply that
  evidence automatically.

<!-- /coderabbit-ai-generated:v1 -->
- **The launch route uses the deterministic planner.** The model adapter is available for a free or
  local completion, but no server-side free-model provider is configured yet.
- **No agent auto-provisioning.** Specialist roles bind to saved agents supplied by the caller.
- **No deadline cancellation.** The engine records the target and reports the overrun; it does not
  kill an in-flight build at minute 15, because that would discard real work mid-verification.
- **No deployment execution.** `allowDeploy` is false in every policy and only owner-authorized,
  verified deployments belong to a separate workflow.

A build is not "autonomous end to end" until the workflow runner invokes the execution verifier
automatically and a real provider-backed benchmark exists. Until then, report this layer as the
contract, planner, execution verifier and scheduler foundation it is.
