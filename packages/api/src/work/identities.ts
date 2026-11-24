import type { TWorkAgentId, TWorkAgentIdentity, TWorkEngineId } from 'coderax-data-provider';
import type { EngineStatusSnapshot } from '../engines/registry';

/**
 * Agent identity is independent of model-provider selection.
 *
 * Coderax Native is always the default and does not depend on an execution
 * engine. OpenCode and FreeBuff are explicit, separately credentialed
 * identities. Their availability is derived from the engine registry so the UI
 * never pretends a disabled external agent can run, and selecting one can never
 * silently fall back to native.
 */

type WorkAgentDefinition = Omit<TWorkAgentIdentity, 'availability'>;

export const WORK_AGENT_DEFINITIONS: readonly WorkAgentDefinition[] = [
  {
    id: 'coderax',
    label: 'Coderax Personal Agent',
    kind: 'native',
    engine: null,
    description:
      'Coderax native agent. Owns planning, tools, memory, approvals and persistence under Coderax policies.',
  },
  {
    id: 'opencode',
    label: 'OpenCode Agent',
    kind: 'external',
    engine: 'opencode',
    description:
      'Runs through the configured OpenCode server. Selecting it sends this conversation turn to that external engine.',
  },
  {
    id: 'freebuff',
    label: 'FreeBuff Agent',
    kind: 'external',
    engine: 'freebuff',
    description:
      'Runs through the configured FreeBuff SDK and cloud endpoint. Selecting it sends this conversation turn to that external engine.',
  },
] as const;

export type ReadWorkAgentId =
  | { kind: 'absent' }
  | { kind: 'invalid'; value: unknown }
  | { kind: 'id'; id: TWorkAgentId };

/** Empty or absent means the native default; an unknown value is never coerced. */
export function readWorkAgentId(value: unknown): ReadWorkAgentId {
  if (value == null || value === '') {
    return { kind: 'absent' };
  }
  const id = typeof value === 'string' ? value.trim() : value;
  if (id === '') {
    return { kind: 'absent' };
  }
  if (id === 'coderax' || id === 'opencode' || id === 'freebuff') {
    return { kind: 'id', id };
  }
  return { kind: 'invalid', value };
}

export type WorkAgentIdentityInput = {
  owner?: boolean;
  snapshot?: EngineStatusSnapshot | null;
  workChatEnabled?: boolean;
  mode?: 'private' | 'cloud';
};

/**
 * The three identities are always listed, even when an external engine is
 * unavailable. A disabled agent is a truthful status, not a hidden option.
 */
export function buildWorkAgentIdentities(input: WorkAgentIdentityInput = {}): TWorkAgentIdentity[] {
  const engines = new Map(
    (input.snapshot?.engines ?? []).map((engine) => [engine.id, engine] as const),
  );

  return WORK_AGENT_DEFINITIONS.map((definition) => {
    if (definition.kind === 'native') {
      return { ...definition, availability: { available: true } };
    }

    if (input.workChatEnabled !== true) {
      return {
        ...definition,
        availability: {
          available: false,
          reason: 'disabled',
          detail: 'External agent execution is disabled in engines.workChat.enabled.',
        },
      };
    }

    if (input.owner !== true) {
      return {
        ...definition,
        availability: {
          available: false,
          reason: 'owner_only',
          detail: 'External agents are available to the Coderax owner only.',
        },
      };
    }

    if (input.mode !== 'cloud') {
      return {
        ...definition,
        availability: {
          available: false,
          reason: 'cloud_required',
          detail: 'External agents require cloud execution. Set engines.workChat.mode to cloud.',
        },
      };
    }

    const engine = definition.engine ? engines.get(definition.engine as TWorkEngineId) : undefined;
    if (!engine) {
      return {
        ...definition,
        availability: {
          available: false,
          reason: 'disabled',
          detail: `${definition.label} is not registered on this server.`,
        },
      };
    }
    if (!engine.availability.available) {
      return {
        ...definition,
        availability: {
          available: false,
          reason: engine.availability.reason,
          detail: engine.availability.detail,
        },
      };
    }
    return { ...definition, availability: { available: true } };
  });
}
