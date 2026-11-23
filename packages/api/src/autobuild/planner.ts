import {
  WORKFLOW_NAME_MAX_LENGTH,
  WORKFLOW_RUN_INPUT_MAX_LENGTH,
  WORKFLOW_STEP_TITLE_MAX_LENGTH,
} from 'coderax-data-provider';
import type { BuildPlan, BuildPlanResult, BuildRole, BuildTask } from './plan';
import type { CompiledBuild, CompileBuildResult } from './compile';
import type { BuildMode, BuildModeDecision } from './modes';
import { assessRequestComplexity, chooseEffectiveMode } from './modes';
import { compileBuildPlan, type RoleAssignment } from './compile';
import { parseBuildPlan } from './plan';

/**
 * Only zero-marginal-cost inference is admitted. A planner may be a local
 * model or a provider's free tier; a paid endpoint makes every build run cost
 * money before any code is written, which this platform forbids.
 */
export type PlannerCost = 'free' | 'local' | 'paid';

export interface PlannerModel {
  provider: string;
  model: string;
  cost: PlannerCost;
}

export type PlannerCompletion = (input: {
  system: string;
  prompt: string;
  signal?: AbortSignal;
}) => Promise<string>;

export interface PlanBuildInput {
  request: string;
  mode: BuildMode;
  orchestratorAgentId: string;
  roleAgents?: Partial<Record<BuildRole, string>>;
  model: PlannerModel;
  complete: PlannerCompletion;
  maxAttempts?: number;
  signal?: AbortSignal;
}

export type PlannerErrorCode =
  | 'empty_request'
  | 'paid_model'
  | 'model_failed'
  | 'invalid_plan'
  | 'compile_failed';

export interface PlanBuildValue {
  plan: BuildPlan;
  decision: BuildModeDecision;
  compiled: CompiledBuild;
  attempts: number;
}

export type PlanBuildResult =
  | { ok: true; value: PlanBuildValue }
  | { ok: false; error: { code: PlannerErrorCode; message: string } };

const MAX_COMPLETION_ATTEMPTS = 3;

const PLAN_SYSTEM_PROMPT = `You are the build planner for Coderax. Return exactly one JSON object and no prose.
The object must match:
{
  "name": "short plan name",
  "request": "the user request",
  "tasks": [
    {
      "id": "lowercase-kebab-id",
      "title": "short task title",
      "role": "orchestrator|research|architecture|frontend|backend|database|security|testing|devops|reviewer",
      "instruction": "a complete, self-contained agent instruction",
      "acceptance": ["an observable criterion", "another criterion"],
      "dependsOn": ["existing-task-id"],
      "maxAttempts": 2,
      "requiresApproval": false
    }
  ]
}
Rules:
- Use only ids [a-z0-9_-], start with a letter or number, and never duplicate an id.
- Every dependency must refer to an earlier task id. The first task has no dependencies.
- Every task needs at least one acceptance criterion that names observable evidence.
- Include a testing task and a reviewer task. The reviewer must depend on testing.
- A task that claims security work requires a security task with verifiable evidence.
- Never claim a task is complete; describe what must be done and proven.
- Keep the plan at eight tasks or fewer. Do not add deployment tasks.
- The request must be reproduced verbatim.`;

function plannerPrompt(request: string, feedback?: string): string {
  return [
    `Project request:\n${request}`,
    feedback == null ? '' : `Your previous response was rejected: ${feedback}`,
    'Produce the JSON build plan now.',
  ]
    .filter((entry) => entry.length > 0)
    .join('\n\n');
}

/** Models often wrap JSON in a fence or add a sentence despite instructions. */
export function extractPlanJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) {
      return undefined;
    }
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

function normalizePlanCandidate(value: unknown, request: string): unknown {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  return { ...(value as Record<string, unknown>), request };
}

function planNameForRequest(request: string): string {
  const oneLine = request.replace(/\s+/g, ' ').trim();
  const prefix = 'Build: ';
  const max = Math.min(WORKFLOW_NAME_MAX_LENGTH, 120);
  return `${prefix}${oneLine.slice(0, Math.max(1, max - prefix.length))}`;
}

function instructionFor(request: string, focus: string): string {
  const excerpt = request.trim().slice(0, 3_000);
  return [
    `Project request:\n${excerpt}`,
    '',
    focus,
    '',
    'Work in the existing repository and follow its conventions. Do not claim completion without evidence.',
  ].join('\n');
}

const SURFACE_PATTERNS = {
  backend:
    /\b(?:api|server|backend|endpoint|route|handler|service|webhook|auth|payment|queue|job)\b/i,
  frontend:
    /\b(?:ui|frontend|page|screen|component|layout|form|button|modal|dashboard|workflow|design)\b/i,
  database:
    /\b(?:database|schema|migration|mongo|postgres|sqlite|sql|collection|index|query|model)\b/i,
  security:
    /\b(?:auth|permission|security|secret|token|payment|privacy|encrypt|oauth|credential)\b/i,
  devops: /\b(?:deploy|ci|pipeline|docker|container|infrastructure|runner)\b/i,
} as const;

function surface(name: keyof typeof SURFACE_PATTERNS, request: string): boolean {
  return SURFACE_PATTERNS[name].test(request);
}

function task(
  id: string,
  title: string,
  role: BuildRole,
  instruction: string,
  acceptance: string[],
  dependsOn: string[],
): BuildTask {
  return {
    id,
    title: title.slice(0, WORKFLOW_STEP_TITLE_MAX_LENGTH),
    role,
    instruction,
    acceptance,
    dependsOn,
    maxAttempts: 2,
    requiresApproval: false,
  };
}

/**
 * Deterministic zero-cost planning. It is deliberately conservative: it maps
 * the request's surfaces to a small evidence-oriented plan, and every task is
 * still validated by the same contract a model plan must satisfy.
 *
 * This is the fallback when no free/local completion is configured. It is not
 * presented as model reasoning; callers that have a free model should use
 * `planBuild` so the plan can reflect repository context.
 */
export function createHeuristicBuildPlan(request: string): BuildPlanResult<BuildPlan> {
  const trimmed = request.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      error: { code: 'invalid_plan', message: 'A project request is required' },
    };
  }
  if (trimmed.length > WORKFLOW_RUN_INPUT_MAX_LENGTH) {
    return {
      ok: false,
      error: {
        code: 'invalid_plan',
        message: `The project request is longer than ${WORKFLOW_RUN_INPUT_MAX_LENGTH} characters`,
      },
    };
  }

  const complexity = assessRequestComplexity(trimmed).complexity;
  const tasks: BuildTask[] = [];
  const research = task(
    'research',
    'Inspect repository and constraints',
    'research',
    instructionFor(
      trimmed,
      'Inspect the repository structure, existing conventions, relevant tests and constraints. Record the exact files and behaviours that will change. Do not edit code in this task.',
    ),
    [
      'Relevant repository files and conventions are identified',
      'Existing tests and risk areas are recorded',
    ],
    [],
  );
  tasks.push(research);

  let base = 'research';
  if (complexity !== 'simple') {
    tasks.push(
      task(
        'architecture',
        'Design the smallest safe change',
        'architecture',
        instructionFor(
          trimmed,
          'Design the smallest change that satisfies the request. Name the modules, data flow, failure modes and rollback. Do not implement code yet.',
        ),
        [
          'Change boundaries and affected modules are documented',
          'Failure modes and rollback are recorded',
        ],
        ['research'],
      ),
    );
    base = 'architecture';
  }

  const backend =
    surface('backend', trimmed) || (!surface('frontend', trimmed) && complexity === 'simple');
  const frontend = surface('frontend', trimmed);
  const database = surface('database', trimmed);
  const security = surface('security', trimmed);
  const devops = surface('devops', trimmed);
  const implementationDeps: string[] = [];

  if (database) {
    tasks.push(
      task(
        'database',
        'Implement the data change',
        'database',
        instructionFor(
          trimmed,
          'Implement the required schema, migration or query change. Keep migrations additive and reversible, preserve existing data, and add focused tests.',
        ),
        [
          'Schema or migration changes are applied and reversible',
          'Focused persistence tests pass',
        ],
        [base],
      ),
    );
    implementationDeps.push('database');
  }

  if (backend) {
    const dependencies = database ? [base, 'database'] : [base];
    tasks.push(
      task(
        'backend',
        'Implement backend behaviour',
        'backend',
        instructionFor(
          trimmed,
          'Implement the backend behaviour, including validation, authorization and error handling. Add or update focused tests for each changed path.',
        ),
        [
          'Each changed backend path has focused test coverage',
          'Validation and authorization failures are handled explicitly',
        ],
        dependencies,
      ),
    );
    implementationDeps.push('backend');
  }

  if (frontend) {
    const dependencies = database ? [base, 'database'] : [base];
    tasks.push(
      task(
        'frontend',
        'Implement the interface',
        'frontend',
        instructionFor(
          trimmed,
          'Implement the interface using the existing design system. Cover loading, empty, error and success states, and keep existing workflows visually intact.',
        ),
        [
          'Loading, empty, error and success states are implemented',
          'The existing design system and layouts are preserved',
        ],
        dependencies,
      ),
    );
    implementationDeps.push('frontend');
  }

  if (implementationDeps.length === 0) {
    tasks.push(
      task(
        'implement',
        'Implement the requested change',
        'backend',
        instructionFor(
          trimmed,
          'Implement the requested change in the existing codebase. Keep the diff minimal, follow local conventions, and add focused tests.',
        ),
        ['The requested behaviour is implemented', 'Focused tests cover the changed behaviour'],
        [base],
      ),
    );
    implementationDeps.push('implement');
  }

  if (security) {
    tasks.push(
      task(
        'security',
        'Review security-sensitive paths',
        'security',
        instructionFor(
          trimmed,
          'Review the changed authentication, authorization, secret handling and input boundaries. Add tests for denial paths. Do not weaken an existing control to make a test pass.',
        ),
        [
          'Unauthorized and malformed requests are denied',
          'No secret is logged or exposed to an external provider',
        ],
        [base, ...implementationDeps],
      ),
    );
    implementationDeps.push('security');
  }

  if (devops) {
    tasks.push(
      task(
        'devops',
        'Validate CI and runtime configuration',
        'devops',
        instructionFor(
          trimmed,
          'Update only the CI or runtime configuration needed by this change. Do not add paid services and do not deploy. Verify the configuration locally where possible.',
        ),
        [
          'CI or runtime configuration is internally consistent',
          'No deployment or paid service is introduced',
        ],
        [base],
      ),
    );
    implementationDeps.push('devops');
  }

  const verifyDeps = [...new Set(implementationDeps)];
  tasks.push(
    task(
      'testing',
      'Run verification and capture evidence',
      'testing',
      instructionFor(
        trimmed,
        'Run the repository test suite and build. Fix failures caused by this change, then report the exact commands, exit codes and pass/fail counts. Do not claim a command passed unless it was executed.',
      ),
      [
        'The plan test command was executed and its exit code recorded',
        'The plan build command was executed and its exit code recorded',
        'Every acceptance criterion above is checked against evidence',
      ],
      verifyDeps,
    ),
  );

  tasks.push(
    task(
      'review',
      'Review the diff and prepare a pull request',
      'reviewer',
      instructionFor(
        trimmed,
        'Review the complete diff for correctness, regressions, security issues and missing tests. Fix blocking findings, then open a reviewable pull request against the repository base branch. Do not merge it.',
      ),
      [
        'The complete diff is reviewed with no unaddressed blocking finding',
        'A reviewable pull request is open against the correct base branch',
        'The pull request is not merged',
      ],
      ['testing'],
    ),
  );

  return parseBuildPlan({
    name: planNameForRequest(trimmed),
    request: trimmed,
    tasks,
  });
}

/**
 * Turn a project request into a validated plan and compiled build definition.
 * A malformed model response is retried with validation feedback; the original
 * request is always restored, so a model cannot silently widen the task.
 */
export async function planBuild(input: PlanBuildInput): Promise<PlanBuildResult> {
  const request = input.request?.trim() ?? '';
  if (request.length === 0) {
    return {
      ok: false,
      error: { code: 'empty_request', message: 'A project request is required' },
    };
  }
  if (input.model.cost === 'paid') {
    return {
      ok: false,
      error: {
        code: 'paid_model',
        message: `Planner model ${input.model.provider}/${input.model.model} is paid; Coderax build planning must use a free or local model`,
      },
    };
  }
  if (input.orchestratorAgentId.trim().length === 0) {
    return {
      ok: false,
      error: {
        code: 'compile_failed',
        message: 'An orchestrator agent is required to start a build',
      },
    };
  }

  const attempts = Math.min(Math.max(input.maxAttempts ?? 2, 1), MAX_COMPLETION_ATTEMPTS);
  let feedback: string | undefined;
  let parsed: BuildPlan | null = null;
  let lastMessage = 'The planner did not return a usable plan';
  let modelFailures = 0;
  let usedAttempts = 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    usedAttempts = attempt;
    let completion: string;
    try {
      completion = await input.complete({
        system: PLAN_SYSTEM_PROMPT,
        prompt: plannerPrompt(request, feedback),
        ...(input.signal == null ? {} : { signal: input.signal }),
      });
    } catch (error) {
      modelFailures += 1;
      lastMessage = error instanceof Error ? error.message : String(error);
      feedback = `the model call failed (${lastMessage})`;
      continue;
    }

    const result = parseBuildPlan(normalizePlanCandidate(extractPlanJson(completion), request));
    if (!result.ok) {
      lastMessage = result.error.message;
      feedback = result.error.message;
      continue;
    }
    parsed = { ...result.value, request };
    break;
  }

  if (parsed == null) {
    return {
      ok: false,
      error: {
        code: modelFailures === attempts ? 'model_failed' : 'invalid_plan',
        message: `The planner did not produce a valid plan after ${attempts} attempt(s): ${lastMessage}`,
      },
    };
  }

  const decision = chooseEffectiveMode({ requested: input.mode, plan: parsed, request });
  const compiled: CompileBuildResult = compileBuildPlan({
    plan: parsed,
    mode: decision.mode,
    orchestratorAgentId: input.orchestratorAgentId,
    ...(input.roleAgents == null ? {} : { roleAgents: input.roleAgents }),
  });
  if (!compiled.ok) {
    return {
      ok: false,
      error: {
        code: 'compile_failed',
        message: compiled.error.message,
      },
    };
  }

  return {
    ok: true,
    value: {
      plan: parsed,
      decision,
      compiled: compiled.value,
      attempts: usedAttempts,
    },
  };
}

/** Bind every role to the orchestrator unless a specialist was supplied. */
export function heuristicRoleAgents(
  orchestratorAgentId: string,
  roleAgents: Partial<Record<BuildRole, string>> = {},
): Partial<Record<BuildRole, string>> {
  return { orchestrator: orchestratorAgentId, ...roleAgents };
}

/** The unresolved roles are shown to the operator before a run starts. */
export function unresolvedRoleAssignments(assignments: RoleAssignment[]): BuildRole[] {
  return assignments
    .filter((assignment) => !assignment.configured)
    .map((assignment) => assignment.role);
}
