import { WORKFLOW_RUN_INPUT_MAX_LENGTH } from 'coderax-data-provider';
import type { BuildMode, BuildModeDecision } from './modes';
import type { BuildPlan, BuildRole } from './plan';
import type { CompiledBuild } from './compile';
import { BUILD_MODES, chooseEffectiveMode } from './modes';
import { createHeuristicBuildPlan } from './planner';
import { compileBuildPlan } from './compile';
import { BUILD_ROLES } from './plan';

export interface StartBuildRequest {
  request: string;
  mode: BuildMode;
  agentId: string;
  roleAgents?: Partial<Record<BuildRole, string>>;
}

export type StartBuildParseResult =
  | { ok: true; value: StartBuildRequest }
  | { ok: false; error: string };

export interface PreparedBuild {
  plan: BuildPlan;
  decision: BuildModeDecision;
  compiled: CompiledBuild;
}

export type PrepareBuildResult =
  | { ok: true; value: PreparedBuild }
  | { ok: false; error: { code: string; message: string } };

const MAX_AGENT_ID_LENGTH = 256;
const MAX_ROLE_AGENTS = BUILD_ROLES.length;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

/**
 * Validates the launch request before any database write. The route never
 * accepts a raw workflow: only a request, a mode and saved agent ids, so a
 * caller cannot bypass plan validation or inject arbitrary steps.
 */
export function parseStartBuild(value: unknown): StartBuildParseResult {
  if (!isRecord(value)) {
    return { ok: false, error: 'A build request is required' };
  }
  const request = typeof value.request === 'string' ? value.request.trim() : '';
  if (request.length === 0) {
    return { ok: false, error: 'Describe the project you want built' };
  }
  if (request.length > WORKFLOW_RUN_INPUT_MAX_LENGTH) {
    return {
      ok: false,
      error: `The project request is longer than ${WORKFLOW_RUN_INPUT_MAX_LENGTH} characters`,
    };
  }
  const mode = value.mode;
  if (typeof mode !== 'string' || !BUILD_MODES.includes(mode as BuildMode)) {
    return { ok: false, error: `Mode must be one of: ${BUILD_MODES.join(', ')}` };
  }
  const agentId = typeof value.agentId === 'string' ? value.agentId.trim() : '';
  if (agentId.length === 0 || agentId.length > MAX_AGENT_ID_LENGTH) {
    return { ok: false, error: 'Choose a saved orchestrator agent' };
  }

  const roleAgents: Partial<Record<BuildRole, string>> = {};
  if (value.roleAgents != null) {
    if (!isRecord(value.roleAgents)) {
      return { ok: false, error: 'roleAgents must be an object of role to agent id' };
    }
    const entries = Object.entries(value.roleAgents);
    if (entries.length > MAX_ROLE_AGENTS) {
      return { ok: false, error: 'Too many role assignments' };
    }
    for (const [role, assigned] of entries) {
      if (!BUILD_ROLES.includes(role as BuildRole)) {
        return { ok: false, error: `Unknown build role: ${role}` };
      }
      if (typeof assigned !== 'string' || assigned.trim().length === 0) {
        return { ok: false, error: `Role ${role} needs a saved agent id` };
      }
      if (assigned.trim().length > MAX_AGENT_ID_LENGTH) {
        return { ok: false, error: `The agent id for ${role} is too long` };
      }
      roleAgents[role as BuildRole] = assigned.trim();
    }
  }

  return {
    ok: true,
    value: {
      request,
      mode: mode as BuildMode,
      agentId,
      ...(Object.keys(roleAgents).length === 0 ? {} : { roleAgents }),
    },
  };
}

/**
 * Plan and compile before touching persistence. An invalid or oversized plan
 * is rejected with a message the UI can show; it never becomes a queued run.
 */
export function prepareBuildLaunch(input: StartBuildRequest): PrepareBuildResult {
  const planned = createHeuristicBuildPlan(input.request);
  if (!planned.ok) {
    return { ok: false, error: planned.error };
  }
  const decision = chooseEffectiveMode({
    requested: input.mode,
    plan: planned.value,
    request: input.request,
  });
  const compiled = compileBuildPlan({
    plan: planned.value,
    mode: decision.mode,
    orchestratorAgentId: input.agentId,
    ...(input.roleAgents == null ? {} : { roleAgents: input.roleAgents }),
  });
  if (!compiled.ok) {
    return { ok: false, error: compiled.error };
  }
  return {
    ok: true,
    value: {
      plan: planned.value,
      decision,
      compiled: compiled.value,
    },
  };
}
