import { z } from 'zod/v4';
import {
  WORKFLOW_INSTRUCTION_MAX_LENGTH,
  WORKFLOW_NAME_MAX_LENGTH,
  WORKFLOW_RUN_INPUT_MAX_LENGTH,
  WORKFLOW_STEP_ID_MAX_LENGTH,
  WORKFLOW_STEP_MAX_ATTEMPTS,
  WORKFLOW_STEP_TITLE_MAX_LENGTH,
  WORKFLOW_STEPS_MAX,
} from 'coderax-data-provider';

/**
 * The specialist roles the build engine coordinates. They are scheduling
 * labels, not separate model installations: each one is bound to an ordinary
 * saved Coderax agent by the caller.
 */
export const BUILD_ROLES = [
  'orchestrator',
  'research',
  'architecture',
  'frontend',
  'backend',
  'database',
  'security',
  'testing',
  'devops',
  'reviewer',
] as const;

export type BuildRole = (typeof BUILD_ROLES)[number];

/** Instructions are shorter than a workflow step so compiled acceptance text still fits. */
export const BUILD_INSTRUCTION_MAX_LENGTH = 6_000;
export const BUILD_ACCEPTANCE_MAX_ITEMS = 10;
export const BUILD_ACCEPTANCE_MAX_LENGTH = 300;

/**
 * A planner's task is executable only after this contract accepts it. A task
 * must name the evidence its completion will be judged on, because a model's
 * assertion that it finished is not proof.
 */
export interface BuildTask {
  id: string;
  title: string;
  role: BuildRole;
  instruction: string;
  acceptance: string[];
  /** Resolved at parse time; an omitted list follows the previous task. */
  dependsOn: string[];
  maxAttempts: number;
  requiresApproval: boolean;
}

export interface BuildPlan {
  name: string;
  request: string;
  tasks: BuildTask[];
}

export interface BuildLayer {
  index: number;
  taskIds: string[];
}

export type BuildPlanErrorCode = 'invalid_plan' | 'cycle';

export type BuildPlanResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: BuildPlanErrorCode; message: string } };

const stepIdSchema = z
  .string()
  .trim()
  .min(1, 'Every task needs an id')
  .max(WORKFLOW_STEP_ID_MAX_LENGTH)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, 'Task ids may use letters, numbers, dashes and underscores');

const acceptanceSchema = z
  .array(z.string().trim().min(1).max(BUILD_ACCEPTANCE_MAX_LENGTH))
  .min(1, 'Every task needs at least one acceptance criterion')
  .max(BUILD_ACCEPTANCE_MAX_ITEMS);

const taskSchema = z.object({
  id: stepIdSchema,
  title: z.string().trim().min(1, 'Every task needs a title').max(WORKFLOW_STEP_TITLE_MAX_LENGTH),
  role: z.enum(BUILD_ROLES),
  instruction: z
    .string()
    .trim()
    .min(1, 'Every task needs an instruction')
    .max(BUILD_INSTRUCTION_MAX_LENGTH),
  acceptance: acceptanceSchema,
  dependsOn: z.array(stepIdSchema).max(WORKFLOW_STEPS_MAX).optional(),
  maxAttempts: z.number().int().min(1).max(WORKFLOW_STEP_MAX_ATTEMPTS).optional(),
  requiresApproval: z.boolean().optional(),
});

const planSchema = z.object({
  name: z.string().trim().min(1, 'A build plan needs a name').max(WORKFLOW_NAME_MAX_LENGTH),
  request: z.string().trim().min(1, 'A build plan needs a request').max(WORKFLOW_RUN_INPUT_MAX_LENGTH),
  tasks: z.array(taskSchema).min(1, 'A build plan needs at least one task').max(WORKFLOW_STEPS_MAX),
});

type ParsedTask = z.infer<typeof taskSchema>;

function issueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue == null) {
    return 'Invalid build plan';
  }
  const path = issue.path.join('.');
  return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
}

/** An omitted dependency keeps the planner's list executable but linear. */
function normalizeTasks(tasks: ParsedTask[]): BuildTask[] {
  return tasks.map((task, index) => ({
    id: task.id,
    title: task.title,
    role: task.role,
    instruction: task.instruction,
    acceptance: [...new Set(task.acceptance)],
    dependsOn: [
      ...new Set(task.dependsOn ?? (index === 0 ? [] : [tasks[index - 1].id])),
    ],
    maxAttempts: task.maxAttempts ?? 2,
    requiresApproval: task.requiresApproval === true,
  }));
}

function dependencyError(tasks: BuildTask[]): string | null {
  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length) {
    return 'Task ids must be unique';
  }
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (dependency === task.id) {
        return `Task ${task.id} cannot depend on itself`;
      }
      if (!ids.has(dependency)) {
        return `Task ${task.id} depends on an unknown task`;
      }
    }
  }
  return null;
}

/**
 * Kahn layering: every task in a layer can run concurrently, and a layer only
 * contains tasks whose dependencies settled in earlier layers. A cycle is
 * reported rather than partially executed.
 */
export function resolveBuildLayers(plan: BuildPlan): BuildPlanResult<BuildLayer[]> {
  const remaining = new Map(plan.tasks.map((task) => [task.id, new Set(task.dependsOn)]));
  const layers: BuildLayer[] = [];
  while (remaining.size > 0) {
    const ready: string[] = [];
    for (const [id, dependencies] of remaining) {
      if (dependencies.size === 0) {
        ready.push(id);
      }
    }
    if (ready.length === 0) {
      return {
        ok: false,
        error: { code: 'cycle', message: 'Build tasks cannot form a dependency cycle' },
      };
    }
    layers.push({ index: layers.length, taskIds: ready });
    for (const id of ready) {
      remaining.delete(id);
    }
    for (const dependencies of remaining.values()) {
      for (const id of ready) {
        dependencies.delete(id);
      }
    }
  }
  return { ok: true, value: layers };
}

/** The longest dependency chain; it is the lower bound on sequential build time. */
export function criticalPathTaskIds(plan: BuildPlan): string[] {
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  const memo = new Map<string, string[]>();
  const visiting = new Set<string>();

  const longest = (id: string): string[] => {
    const cached = memo.get(id);
    if (cached != null) {
      return cached;
    }
    if (visiting.has(id)) {
      return [];
    }
    visiting.add(id);
    let best: string[] = [];
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      const candidate = longest(dependency);
      if (candidate.length > best.length) {
        best = candidate;
      }
    }
    visiting.delete(id);
    const path = [...best, id];
    memo.set(id, path);
    return path;
  };

  let result: string[] = [];
  for (const task of plan.tasks) {
    const path = longest(task.id);
    if (path.length > result.length) {
      result = path;
    }
  }
  return result;
}

export interface BuildPlanAssessment {
  taskCount: number;
  roleCount: number;
  roles: BuildRole[];
  layerCount: number;
  maxLayerWidth: number;
  criticalPathTaskIds: string[];
  criticalPathLength: number;
  hasTestingTask: boolean;
  hasReviewTask: boolean;
  hasSecurityTask: boolean;
  /** A security review is required when the plan asks for it or claims security work. */
  requiresSecurityReview: boolean;
}

const SECURITY_CLAIM = /\b(security|secret|credential|authentication|authorization|tenant)\b/i;

export function assessBuildPlan(plan: BuildPlan): BuildPlanAssessment {
  const layers = resolveBuildLayers(plan);
  const resolved = layers.ok ? layers.value : [];
  const roles = [...new Set(plan.tasks.map((task) => task.role))];
  const criticalPath = criticalPathTaskIds(plan);
  return {
    taskCount: plan.tasks.length,
    roleCount: roles.length,
    roles,
    layerCount: resolved.length,
    maxLayerWidth: resolved.reduce((width, layer) => Math.max(width, layer.taskIds.length), 0),
    criticalPathTaskIds: criticalPath,
    criticalPathLength: criticalPath.length,
    hasTestingTask: plan.tasks.some((task) => task.role === 'testing'),
    hasReviewTask: plan.tasks.some((task) => task.role === 'reviewer'),
    hasSecurityTask: plan.tasks.some((task) => task.role === 'security'),
    requiresSecurityReview:
      plan.tasks.some((task) => task.role === 'security') ||
      plan.tasks.some((task) => task.acceptance.some((entry) => SECURITY_CLAIM.test(entry))),
  };
}

/**
 * Parse untrusted planner output. The returned plan has concrete dependencies,
 * deduplicated acceptance criteria and bounded retry counts; nothing downstream
 * has to guess what an omitted field meant.
 */
export function parseBuildPlan(value: unknown): BuildPlanResult<BuildPlan> {
  const parsed = planSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: { code: 'invalid_plan', message: issueMessage(parsed.error) } };
  }
  const tasks = normalizeTasks(parsed.data.tasks);
  const error = dependencyError(tasks);
  if (error != null) {
    return { ok: false, error: { code: 'invalid_plan', message: error } };
  }
  const plan: BuildPlan = { name: parsed.data.name, request: parsed.data.request, tasks };
  const layers = resolveBuildLayers(plan);
  if (!layers.ok) {
    return layers;
  }
  return { ok: true, value: plan };
}
