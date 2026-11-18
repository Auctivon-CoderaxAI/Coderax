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
meet it. No mode authorizes a deployment, and no mode lowers the evidence requirement to pass.

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

## Not implemented in this change

- **No planner model call.** Something must produce the plan; `parseBuildPlan` validates it.
- **No HTTP route or UI entry point.** Compiled plans are ordinary workflows, so they are created
  and run through the existing Workflows API/UI. A dedicated build surface is a separate change.
- **No agent auto-provisioning.** Specialist roles bind to saved agents supplied by the caller.
- **No deadline cancellation.** The engine records the target and reports the overrun; it does not
  kill an in-flight build at minute 15, because that would discard real work mid-verification.
- **No deployment execution.** `allowDeploy` is false in every policy and only owner-authorized,
  verified deployments belong to a separate workflow.

A build is not "autonomous end to end" until a planner adapter, a build entry point and a real
provider-backed benchmark exist. Until then, report this layer as the contract and scheduler
foundation it is.
