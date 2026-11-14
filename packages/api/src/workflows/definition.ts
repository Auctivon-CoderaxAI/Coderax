import { z } from 'zod/v4';
import { scheduleCadenceSchema } from 'coderax-data-provider';
import {
  WORKFLOW_CONDITIONS_MAX,
  WORKFLOW_CONDITION_MATCH_MAX_LENGTH,
  WORKFLOW_DESCRIPTION_MAX_LENGTH,
  WORKFLOW_EVENT_SOURCE_MAX_LENGTH,
  WORKFLOW_EVENT_TRIGGERS_MAX,
  WORKFLOW_EVENT_TYPE_MAX_LENGTH,
  WORKFLOW_INSTRUCTION_MAX_LENGTH,
  WORKFLOW_MAX_PARALLEL,
  WORKFLOW_NAME_MAX_LENGTH,
  WORKFLOW_RUN_INPUT_MAX_LENGTH,
  WORKFLOW_STEP_ID_MAX_LENGTH,
  WORKFLOW_STEP_MAX_ATTEMPTS,
  WORKFLOW_STEP_TIMEOUT_MS_MAX,
  WORKFLOW_STEP_TIMEOUT_MS_MIN,
  WORKFLOW_STEP_TITLE_MAX_LENGTH,
  WORKFLOW_STEPS_MAX,
} from 'coderax-data-provider';
import type {
  WorkflowEventTrigger,
  WorkflowSettings,
  WorkflowStepCondition,
  WorkflowStepInput,
} from 'coderax-data-provider';

export const workflowStepIdPattern: RegExp = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

const stepIdSchema = z
  .string()
  .trim()
  .min(1, 'Every step needs an id')
  .max(WORKFLOW_STEP_ID_MAX_LENGTH)
  .regex(workflowStepIdPattern, 'Step ids may use letters, numbers, dashes and underscores');

const conditionSchema = z.object({
  stepId: stepIdSchema,
  status: z.enum(['completed', 'failed', 'skipped']).optional(),
  resultIncludes: z.string().trim().min(1).max(WORKFLOW_CONDITION_MATCH_MAX_LENGTH).optional(),
});

const runIfSchema = z.union([
  conditionSchema,
  z.array(conditionSchema).min(1).max(WORKFLOW_CONDITIONS_MAX),
]);

const stepSchema = z.object({
  id: stepIdSchema,
  title: z.string().trim().min(1, 'Every step needs a title').max(WORKFLOW_STEP_TITLE_MAX_LENGTH),
  instruction: z
    .string()
    .trim()
    .min(1, 'Every step needs an instruction')
    .max(WORKFLOW_INSTRUCTION_MAX_LENGTH),
  approvalRequired: z.boolean().optional(),
  maxAttempts: z.number().int().min(1).max(WORKFLOW_STEP_MAX_ATTEMPTS).optional(),
  agentId: z.string().trim().min(1).max(256).optional(),
  dependsOn: z.array(stepIdSchema).max(WORKFLOW_STEPS_MAX).optional(),
  runIf: runIfSchema.optional(),
  join: z.enum(['all', 'any']).optional(),
  timeoutMs: z
    .number()
    .int()
    .min(WORKFLOW_STEP_TIMEOUT_MS_MIN)
    .max(WORKFLOW_STEP_TIMEOUT_MS_MAX)
    .optional(),
});

function dependenciesOf(steps: WorkflowStepInput[], index: number): string[] {
  const step = steps[index];
  if (step.dependsOn != null) {
    return step.dependsOn;
  }
  return index === 0 ? [] : [steps[index - 1].id];
}

function conditionsOfInput(value: WorkflowStepInput['runIf']): WorkflowStepCondition[] {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function hasCycle(steps: WorkflowStepInput[]): string | null {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string): boolean => {
    if (visiting.has(id)) {
      return true;
    }
    if (visited.has(id)) {
      return false;
    }
    visiting.add(id);
    const step = byId.get(id);
    const cycles = step == null ? false : step.dependsOn?.some((dependency) => visit(dependency));
    visiting.delete(id);
    visited.add(id);
    return cycles === true;
  };

  for (const step of steps) {
    if (visit(step.id)) {
      return step.id;
    }
  }
  return null;
}

const stepsSchema = z
  .array(stepSchema)
  .min(1, 'A workflow needs at least one step')
  .max(WORKFLOW_STEPS_MAX)
  .superRefine((steps, ctx) => {
    const seen = new Set<string>();
    steps.forEach((step, index) => {
      if (seen.has(step.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'id'],
          message: 'Step ids must be unique',
        });
      }
      seen.add(step.id);
    });

    steps.forEach((step, index) => {
      const dependencies = dependenciesOf(steps, index);
      dependencies.forEach((dependencyId) => {
        if (dependencyId === step.id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'dependsOn'],
            message: 'A step cannot depend on itself',
          });
        } else if (!seen.has(dependencyId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'dependsOn'],
            message: `Step ${step.id} depends on an unknown step`,
          });
        }
      });
      const conditions = conditionsOfInput(step.runIf);
      const seenConditions = new Set<string>();
      conditions.forEach((condition) => {
        if (seenConditions.has(condition.stepId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'runIf'],
            message: 'A condition may name a step only once',
          });
        }
        seenConditions.add(condition.stepId);
        if (!seen.has(condition.stepId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'runIf'],
            message: 'A condition must name a step in this workflow',
          });
        } else if (!dependencies.includes(condition.stepId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'runIf'],
            message: 'A condition step must also be listed as a dependency',
          });
        }
      });
    });

    const cycle = hasCycle(
      steps.map((step, index) => ({ ...step, dependsOn: dependenciesOf(steps, index) })),
    );
    if (cycle != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [0, 'dependsOn'],
        message: 'Steps cannot form a dependency cycle',
      });
    }
  });

const settingsSchema = z.object({
  maxParallel: z.number().int().min(1).max(WORKFLOW_MAX_PARALLEL).optional(),
  stepTimeoutMs: z
    .number()
    .int()
    .min(WORKFLOW_STEP_TIMEOUT_MS_MIN)
    .max(WORKFLOW_STEP_TIMEOUT_MS_MAX)
    .optional(),
});

const scheduleSchema = z.object({
  enabled: z.boolean(),
  cadence: scheduleCadenceSchema,
  timezone: z.string().trim().min(1).max(64),
  input: z.string().trim().max(WORKFLOW_RUN_INPUT_MAX_LENGTH).optional(),
});

const eventTriggerSchema = z.object({
  eventType: z
    .string()
    .trim()
    .min(1, 'An event trigger needs an event type')
    .max(WORKFLOW_EVENT_TYPE_MAX_LENGTH)
    .regex(
      /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/,
      'Event types may use letters, numbers, dots, dashes, underscores and colons',
    ),
  sourceId: z.string().trim().min(1).max(WORKFLOW_EVENT_SOURCE_MAX_LENGTH).optional(),
  input: z.string().trim().max(WORKFLOW_RUN_INPUT_MAX_LENGTH).optional(),
});

const eventTriggersSchema = z
  .array(eventTriggerSchema)
  .max(WORKFLOW_EVENT_TRIGGERS_MAX)
  .superRefine((triggers, ctx) => {
    const seen = new Set<string>();
    triggers.forEach((trigger, index) => {
      const key = `${trigger.eventType}\u0000${trigger.sourceId ?? '*'}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: 'That event trigger is already listed',
        });
      }
      seen.add(key);
    });
  });

const createSchema = z.object({
  name: z.string().trim().min(1, 'A workflow needs a name').max(WORKFLOW_NAME_MAX_LENGTH),
  description: z.string().trim().max(WORKFLOW_DESCRIPTION_MAX_LENGTH).optional(),
  agentId: z.string().trim().min(1, 'Choose an agent for this workflow').max(256),
  steps: stepsSchema,
  settings: settingsSchema.optional(),
  schedule: scheduleSchema.nullable().optional(),
  eventTriggers: eventTriggersSchema.optional(),
  onCompleteWorkflowId: z.string().trim().min(1).max(128).nullable().optional(),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(WORKFLOW_NAME_MAX_LENGTH).optional(),
    description: z.string().trim().max(WORKFLOW_DESCRIPTION_MAX_LENGTH).nullable().optional(),
    agentId: z.string().trim().min(1).max(256).optional(),
    steps: stepsSchema.optional(),
    settings: settingsSchema.nullable().optional(),
    schedule: scheduleSchema.nullable().optional(),
    eventTriggers: eventTriggersSchema.nullable().optional(),
    onCompleteWorkflowId: z.string().trim().min(1).max(128).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nothing to update',
  });

const runInputSchema = z
  .object({
    input: z.string().trim().max(WORKFLOW_RUN_INPUT_MAX_LENGTH).optional(),
  })
  .optional();

const approveSchema = z.object({
  stepIndex: z
    .number()
    .int()
    .min(0)
    .max(WORKFLOW_STEPS_MAX - 1),
});

export interface CreateWorkflowPayload {
  name: string;
  description?: string;
  agentId: string;
  steps: WorkflowStepInput[];
  settings?: WorkflowSettings;
  schedule?: WorkflowSchedulePayload | null;
  eventTriggers?: WorkflowEventTrigger[];
  onCompleteWorkflowId?: string | null;
}

export interface WorkflowSchedulePayload {
  enabled: boolean;
  cadence: z.infer<typeof scheduleCadenceSchema>;
  timezone: string;
  input?: string;
}

export interface UpdateWorkflowPayload {
  name?: string;
  description?: string | null;
  agentId?: string;
  steps?: WorkflowStepInput[];
  settings?: WorkflowSettings | null;
  schedule?: WorkflowSchedulePayload | null;
  eventTriggers?: WorkflowEventTrigger[] | null;
  onCompleteWorkflowId?: string | null;
}

export interface StartWorkflowRunPayload {
  input?: string;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function issueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid workflow';
}

export function parseCreateWorkflow(value: unknown): ParseResult<CreateWorkflowPayload> {
  const parsed = createSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: issueMessage(parsed.error) };
  }
  return { ok: true, value: parsed.data };
}

export function parseUpdateWorkflow(value: unknown): ParseResult<UpdateWorkflowPayload> {
  const parsed = updateSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: issueMessage(parsed.error) };
  }
  return { ok: true, value: parsed.data };
}

export function parseStartWorkflowRun(value: unknown): ParseResult<StartWorkflowRunPayload> {
  const parsed = runInputSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: issueMessage(parsed.error) };
  }
  return { ok: true, value: parsed.data ?? {} };
}

export function parseApproveWorkflowStep(value: unknown): ParseResult<{ stepIndex: number }> {
  const parsed = approveSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: issueMessage(parsed.error) };
  }
  return { ok: true, value: parsed.data };
}
