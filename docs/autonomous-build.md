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

## Verification runner

`runBuildVerification({ workspaceRoot, commands, signal })` executes commands instead of assuming a
pass. It validates every executable against an allowlist, rejects executable paths, resolves `cwd`
with symlinks and rejects paths outside the run's checkout, spawns with `shell: false` on POSIX (on
Windows a shell resolves `.cmd` shims only when the arguments are restricted to shell-safe tokens),
enforces a timeout with a process-tree kill, bounds and redacts output, and converts exit codes into
`BuildGateEvidence`. `tests`, `build` and `security` are executable gates; `review` remains a
judgement. A gate with no configured command is `not_run`, never `passed`. The resulting evidence is
accepted by `summarizeBuild`.

## Planner adapter and launch path

`planBuild()` accepts an injected completion function. It rejects a planner marked `paid`, extracts
JSON from fenced or conversational output, validates the object with `parseBuildPlan`, retries with
the validation message, restores the original request, chooses the effective mode and compiles the
workflow. `createHeuristicBuildPlan()` is the deterministic zero-cost fallback when no free or local
completion is configured.

`POST /api/workflows/builds` accepts a project request, mode, saved orchestrator agent, repository
and workspace, validates the request, compiles a deterministic plan, authorizes every bound agent,
then creates and starts the ordinary durable workflow. A workspace is one directory name under the
deployment build root. The reservation is global, not per user: every account shares the
`workspaceRoot`, so a second unsettled run bound to the same workspace is rejected with `409`. The
run insert itself carries a unique `workspaceKey`, so two simultaneous launches — from any users —
cannot both pass the check; the loser gets the same `409` and the workflow created for a rejected
launch is removed. A completed or failed run releases the reservation at settlement. A cancelled
run keeps it until the cancellation handler has retired its queued deliveries and aborted its
active turn, then releases it; if that cleanup cannot be completed the reservation stays held rather
than admitting a second writer. The Workflows view has a **New autonomous build** launcher; on success it
selects the created workflow so the existing run panel and stream monitor it.

Every step turn is bound to the same checkout. The workflow step enqueuer attaches
`codeWorkspaces: [{ environmentId: buildVerification.workspaceEnvironmentId, workspaceId: <workspace> }]`
to the step's fire envelope, and the agent run resolves its reads, writes and commands through that
selection, so two builds with different workspace names cannot edit one tree. The turn fails rather
than running anywhere else when it cannot honor the selection: the agent is not a stateful-code
agent on that attached environment, its configured environment differs from
`workspaceEnvironmentId`, or the worker does not register the workspace id. The failure is an
admission rejection, so no reads, writes or commands run outside the reserved checkout while the
step is retried or failed. The selection is host-controlled trigger context, like `chatProjectId`;
a model or build request cannot choose it.

Before enabling the unique reservation index on an existing deployment, pause new build launches
and check for active workspace-bound runs created before this release:

```javascript
db.workflowruns.aggregate([
  {
    $match: {
      'settings.build.workspace': { $type: 'string' },
      workspaceKey: { $exists: false },
      status: { $nin: ['completed', 'failed', 'cancelled'] },
    },
  },
  { $group: { _id: '$settings.build.workspace', count: { $sum: 1 } } },
]);
```

Let those runs finish or cancel them, then confirm the unique index on `workspaceKey` has built
successfully before resuming launches. The index is sparse, so runs without a binding are ignored.

## Settlement verification

`compileBuildPlan()` records the evidence contract on the run itself as `settings.build`: the mode,
the repository, the run's workspace binding, the plan's required gates, the deadline, the reviewer
step id and the pull-request rule. Scheduled, event-triggered and chained runs acquire the same
workspace reservation when their run is inserted, so they cannot bypass the launcher's check. A
scheduled occurrence whose workspace is busy releases its claim and retries; an event-triggered
occurrence raises the reservation conflict to its delivery lane instead of starting against another
run's checkout. When every step has settled, the workflow engine calls its
`verifyRun` port before it may set `completed`.

- `verifyBuildRun(input, config)` resolves the run's own checkout as
  `<workspaceRoot>/<workspace>` with symlink-aware containment, runs the deployment's commands there
  through `runBuildVerification`, adds the reviewer step's retained output as the `review` gate,
  reads the pull-request URL from the reviewer's retained result, and judges the whole run with
  `summarizeBuild`. A run without a repository or workspace binding, or whose workspace is missing
  or escapes the deployment root, fails closed instead of checking another build's tree.
- Only a `verified` verdict permits `completed`. A missing verifier, a thrown error, or any other
  verdict fails the run with a safe, fixed message.
- The verdict is retained on the run as `verification` — status, outcome, gates, blockers, pull
  request URL and summary — and is returned in `WorkflowRunView`, so an operator sees why a build
  did not complete.

The workspace base root, the attached machine that hosts it, the commands and the executable
allowlist come from `config.workflows.buildVerification` in `coderax.yaml`, never from the build
request body: a plan cannot choose where the steps edit or where settlement runs, or which executable
it invokes. The request only names the repository and the workspace directory under that root, and
both the step binding and the verifier confine themselves to it. Without that configuration the port
is not wired, so every build run fails closed instead of completing unverified.

```yaml
# coderax.yaml
workflows:
  # The runner fields are required whenever this block is present. The values
  # below reproduce the built-in defaults; raising leaseMs only widens the
  # claim, settlement renews it on a heartbeat either way.
  concurrency: 4
  leaseMs: 30000
  tickMs: 1000
  retryBaseMs: 2000
  retryCapMs: 60000
  stepTimeoutMs: 1800000
  scheduleConcurrency: 5
  buildVerification:
    # Absolute directory holding one checkout per build workspace. Required.
    # A build runs in <workspaceRoot>/<workspace binding>.
    workspaceRoot: /srv/coderax/workspaces
    # Attached code environment that hosts those checkouts. Required. Register
    # each <workspaceRoot>/<name> directory on it with `name` as the workspace
    # id, so a step's bound workspace resolves to the same tree the verifier
    # checks. A build agent that is not a stateful-code agent on this
    # environment, or whose workspace id is not registered, fails closed.
    workspaceEnvironmentId: build-machine
    commands:
      - gate: tests
        command: npm
        args: [test, --, --ci]
        timeoutMs: 900000
        label: Focused tests
      - gate: build
        command: npm
        args: [run, build]
      - gate: security
        command: npm
        args: [audit, --audit-level=high]
    # Replaces the built-in executable allowlist when set.
    allowedCommands: [npm, npx, node]
    # Defaults to true: delivery then needs an open pull request URL in the
    # reviewer's retained output. Set false to accept a build without one.
    requirePullRequest: true
    # Applies to a command that omits its own timeoutMs.
    defaultTimeoutMs: 600000
```

The workflow engine refuses to arm when `workspaceEnvironmentId` does not name a configured attached
stateful-code environment. A typo fails startup with the configured ids listed, rather than surfacing
later as a failed build step.

`gate` is one of `tests`, `build` or `security`; `review` is never a command, it comes from the
reviewer step named at compile time. Every executable must be a bare name on the allowlist (a path
is rejected), `cwd` is resolved inside the run's checkout with symlinks followed, and nothing is
spawned through a shell, so the block cannot widen its own authority.

## Not implemented in this change

- **No checkout provisioning.** The deployment creates each `<workspaceRoot>/<workspace>` checkout
  and registers it on `workspaceEnvironmentId` under the same id; the launcher binds a build to it but
  does not clone or clean it.

- **The launch route uses the deterministic planner.** The model adapter is available for a free or
  local completion, but no server-side free-model provider is configured yet.
- **No agent auto-provisioning.** Specialist roles bind to saved agents supplied by the caller.
- **No deadline cancellation.** The engine records the target and reports the overrun; it does not
  kill an in-flight build at minute 15, because that would discard real work mid-verification.
- **No deployment execution.** `allowDeploy` is false in every policy and only owner-authorized,
  verified deployments belong to a separate workflow.

A build is not "autonomous end to end" until a real provider-backed benchmark exists. Until then,
report this layer as the contract, planner, settlement verifier and scheduler foundation it is.
