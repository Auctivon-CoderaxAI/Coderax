import {
  WORKFLOW_DESCRIPTION_MAX_LENGTH,
  WORKFLOW_INSTRUCTION_MAX_LENGTH,
  WORKFLOW_MAX_PARALLEL,
  WORKFLOW_STEP_MAX_ATTEMPTS,
} from 'coderax-data-provider';
import type { WorkflowStepInput } from 'coderax-data-provider';
import type { CreateWorkflowPayload } from '../workflows/definition';
import type { BuildMode, BuildModePolicy } from './modes';
import type { BuildPlan, BuildRole, BuildTask } from './plan';
import { getBuildModePolicy } from './modes';

export interface BuildRepositoryContext {
  owner: string;
  name: string;
  baseRef?: string;
}

export interface CompileBuildOptions {
  plan: BuildPlan;
  mode: BuildMode;
  /** The saved agent that owns the run and receives tasks without a specialist. */
  orchestratorAgentId: string;
  roleAgents?: Partial<Record<BuildRole, string>>;
  repository?: BuildRepositoryContext;
  now?: Date;
}

export interface RoleAssignment {
  role: BuildRole;
  agentId: string;
  /** False means the orchestrator received the task because no specialist is bound. */
  configured: boolean;
}

export interface CompiledBuild {
  workflow: CreateWorkflowPayload;
  policy: BuildModePolicy;
  deadlineAt: string | null;
  roleAssignments: RoleAssignment[];
  unresolvedRoles: BuildRole[];
}

export type CompileBuildErrorCode =
  | 'missing_orchestrator'
  | 'plan_exceeds_mode'
  | 'instruction_too_long';

export type CompileBuildResult =
  | { ok: true; value: CompiledBuild }
  | { ok: false; error: { code: CompileBuildErrorCode; message: string } };

const MODE_GUIDANCE: Record<BuildMode, string> = {
  turbo15:
    'The target is a verified MVP within 15 minutes. If the target is missed, keep working and report it; never skip verification or claim unfinished work is complete.',
  autonomous:
    'Continue until every acceptance criterion is met or a genuine external blocker is recorded. Do not stop to ask for routine follow-up.',
  verified:
    'Prioritise complete tests, security review and reliability over speed. Treat unverified work as unfinished.',
};

function sanitizeInline(value: string, maxLength: number): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLength);
}

function repositoryContext(repository: BuildRepositoryContext | undefined): string | null {
  if (repository == null) {
    return null;
  }
  const owner = sanitizeInline(repository.owner, 100);
  const name = sanitizeInline(repository.name, 100);
  const baseRef = repository.baseRef == null ? '' : sanitizeInline(repository.baseRef, 100);
  if (owner.length === 0 || name.length === 0) {
    return null;
  }
  return [
    `Repository: ${owner}/${name}.`,
    baseRef.length > 0 ? `Base branch: ${baseRef}.` : 'Use the repository default branch as the base.',
    'Work on a feature branch and open a pull request. Never push directly to the protected branch.',
  ].join(' ');
}

/**
 * The task instruction carries what the agent is judged on. Acceptance
 * criteria and the evidence rule travel with every task, so a step can never
 * look successful merely because its turn ended.
 */
function compileInstruction(
  task: BuildTask,
  plan: BuildPlan,
  mode: BuildMode,
  repository: BuildRepositoryContext | undefined,
): string {
  const sections = [
    task.instruction,
    ['Acceptance criteria:', ...task.acceptance.map((criterion) => `- ${criterion}`)].join('\n'),
    `Execution mode: ${mode}. ${MODE_GUIDANCE[mode]}`,
    repositoryContext(repository),
    'Report the exact commands you ran, their outcomes, and the files you changed. Do not claim a task, test, build or deployment succeeded without recorded evidence.',
  ].filter((section): section is string => section != null && section.length > 0);
  return `${sections.join('\n\n')}\n\nBuild request: ${plan.request}`;
}

function roleAssignment(
  role: BuildRole,
  orchestratorAgentId: string,
  roleAgents: CompileBuildOptions['roleAgents'],
): RoleAssignment {
  const assigned = roleAgents?.[role]?.trim();
  if (assigned == null || assigned.length === 0) {
    return { role, agentId: orchestratorAgentId, configured: false };
  }
  return { role, agentId: assigned, configured: true };
}

/**
 * Compile a validated plan into an ordinary workflow definition. The existing
 * durable workflow engine owns leases, retries, cancellation, checkpoint
 * recovery and parallel turn dispatch; this function only decides what runs,
 * with which specialist, and under which evidence contract.
 */
export function compileBuildPlan(options: CompileBuildOptions): CompileBuildResult {
  const { plan, mode, orchestratorAgentId, roleAgents, repository } = options;
  const orchestrator = orchestratorAgentId?.trim() ?? '';
  if (orchestrator.length === 0) {
    return {
      ok: false,
      error: { code: 'missing_orchestrator', message: 'A build needs an orchestrator agent' },
    };
  }

  const policy = getBuildModePolicy(mode);
  if (plan.tasks.length > policy.maxTasks) {
    return {
      ok: false,
      error: {
        code: 'plan_exceeds_mode',
        message: `The plan has ${plan.tasks.length} tasks; ${mode} admits at most ${policy.maxTasks}. Choose a wider mode explicitly.`,
      },
    };
  }

  const roles = [...new Set(plan.tasks.map((task) => task.role))];
  const roleAssignments = roles.map((role) => roleAssignment(role, orchestrator, roleAgents));
  const assignmentFor = new Map(roleAssignments.map((entry) => [entry.role, entry]));

  const steps: WorkflowStepInput[] = [];
  for (const task of plan.tasks) {
    const instruction = compileInstruction(task, plan, mode, repository);
    if (instruction.length > WORKFLOW_INSTRUCTION_MAX_LENGTH) {
      return {
        ok: false,
        error: {
          code: 'instruction_too_long',
          message: `Task ${task.id} compiles to ${instruction.length} characters; the limit is ${WORKFLOW_INSTRUCTION_MAX_LENGTH}.`,
        },
      };
    }
    const assignment = assignmentFor.get(task.role);
    const agentId = assignment?.agentId ?? orchestrator;
    steps.push({
      id: task.id,
      title: task.title,
      instruction,
      dependsOn: task.dependsOn,
      maxAttempts: Math.min(task.maxAttempts, policy.maxAttempts, WORKFLOW_STEP_MAX_ATTEMPTS),
      ...(task.requiresApproval ? { approvalRequired: true } : {}),
      ...(agentId === orchestrator ? {} : { agentId }),
    });
  }

  const startedAt = options.now ?? new Date();
  const deadlineAt =
    policy.deadlineMs == null
      ? null
      : new Date(startedAt.getTime() + policy.deadlineMs).toISOString();
  const description = sanitizeInline(
    `${mode} build plan. ${plan.request}`,
    WORKFLOW_DESCRIPTION_MAX_LENGTH,
  );

  return {
    ok: true,
    value: {
      workflow: {
        name: plan.name,
        description,
        agentId: orchestrator,
        steps,
        settings: {
          maxParallel: Math.min(policy.maxParallel, WORKFLOW_MAX_PARALLEL, plan.tasks.length),
        },
      },
      policy,
      deadlineAt,
      roleAssignments,
      unresolvedRoles: roleAssignments
        .filter((entry) => !entry.configured)
        .map((entry) => entry.role),
    },
  };
}
