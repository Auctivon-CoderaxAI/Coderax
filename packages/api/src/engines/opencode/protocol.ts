import type { EngineEvent } from '../types';

/**
 * Maps the official OpenCode SDK event stream onto Coderax's normalized engine
 * events. OpenCode reports cumulative text parts and per-part tool state, so the
 * mapper tracks what it already emitted. Unknown events and malformed payloads
 * are ignored rather than failing the run: the SDK evolves and an unrecognised
 * informational event must not abort a task.
 */

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  value != null && typeof value === 'object' && !Array.isArray(value);

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const readNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** Bound a tool result so one command cannot flood the event stream. */
export const MAX_TOOL_OUTPUT = 8_000;

function bound(text: string): string {
  return text.length <= MAX_TOOL_OUTPUT ? text : `${text.slice(0, MAX_TOOL_OUTPUT)}…`;
}

function toolOutput(state: Json): string | undefined {
  const output = state.output;
  if (typeof output === 'string') {
    return bound(output);
  }
  const error = state.error;
  if (typeof error === 'string') {
    return bound(error);
  }
  return undefined;
}

function toolName(part: Json): string {
  return readString(part.tool) ?? 'tool';
}

export class OpenCodeEventMapper {
  private readonly sessionId: string;
  /** Text emitted for each part, reconciled across cumulative and delta forms. */
  private readonly emittedText = new Map<string, string>();
  private readonly toolStatus = new Map<string, string>();
  private readonly filePaths = new Set<string>();
  private terminal: 'completed' | 'failed' | 'cancelled' | null = null;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  get finished(): boolean {
    return this.terminal !== null;
  }

  map(raw: unknown): EngineEvent[] {
    if (!isRecord(raw)) {
      return [];
    }
    const type = readString(raw.type);
    const properties = isRecord(raw.properties) ? raw.properties : null;
    if (!type || !properties) {
      return [];
    }

    switch (type) {
      case 'message.part.updated':
        return this.mapPartUpdate(properties);
      case 'message.part.delta':
        return this.mapPartDelta(properties);
      case 'file.edited': {
        const file = readString(properties.file);
        if (!file) {
          return [];
        }
        return this.fileEdit(file);
      }
      case 'permission.asked':
      case 'permission.v2.asked':
        return this.mapPermission(properties);
      case 'session.error':
        return this.mapSessionError(properties);
      case 'session.idle':
      case 'session.status':
        return this.mapSessionIdle(type, properties);
      default:
        return [];
    }
  }

  private mapPartUpdate(properties: Json): EngineEvent[] {
    const part = isRecord(properties.part) ? properties.part : null;
    if (!part || readString(part.sessionID) !== this.sessionId) {
      return [];
    }
    const partType = readString(part.type);
    if (partType === 'text') {
      const id = readString(part.id);
      const text = readString(part.text);
      if (!id || text === undefined) {
        return [];
      }
      const emitted = this.emittedText.get(id) ?? '';
      if (text === emitted) {
        return [];
      }
      if (text.startsWith(emitted)) {
        const delta = text.slice(emitted.length);
        this.emittedText.set(id, text);
        return delta ? [{ type: 'text_delta', text: delta }] : [];
      }
      if (emitted.startsWith(text)) {
        return [];
      }
      // A cumulative part can replace an earlier value. Emit only the tail
      // after the common prefix so already-streamed text is not duplicated.
      let common = 0;
      while (common < text.length && common < emitted.length && text[common] === emitted[common]) {
        common += 1;
      }
      this.emittedText.set(id, text);
      return common < text.length ? [{ type: 'text_delta', text: text.slice(common) }] : [];
    }
    if (partType === 'tool') {
      return this.mapToolPart(part);
    }
    if (partType === 'step-finish') {
      const tokens = isRecord(part.tokens) ? part.tokens : null;
      const inputTokens = readNumber(tokens?.input);
      const outputTokens = readNumber(tokens?.output);
      if (inputTokens === undefined && outputTokens === undefined) {
        return [];
      }
      return [
        {
          type: 'usage',
          ...(inputTokens !== undefined ? { inputTokens } : {}),
          ...(outputTokens !== undefined ? { outputTokens } : {}),
        },
      ];
    }
    return [];
  }

  /**
   * Older servers emit deltas instead of full parts. Deltas append to the text
   * already emitted for the part, and a later cumulative update emits only its
   * uncaptured suffix, so mixed streams never duplicate a character.
   */
  private mapPartDelta(properties: Json): EngineEvent[] {
    if (readString(properties.sessionID) !== this.sessionId) {
      return [];
    }
    const partId = readString(properties.partID);
    const delta = readString(properties.delta);
    if (!partId || delta === undefined) {
      return [];
    }
    const emitted = this.emittedText.get(partId) ?? '';
    this.emittedText.set(partId, emitted + delta);
    return [{ type: 'text_delta', text: delta }];
  }

  private mapToolPart(part: Json): EngineEvent[] {
    const callId = readString(part.callID) ?? readString(part.id);
    if (!callId) {
      return [];
    }
    const state = isRecord(part.state) ? part.state : null;
    if (!state) {
      return [];
    }
    const status = readString(state.status) ?? 'unknown';
    const tool = toolName(part);
    const previous = this.toolStatus.get(callId);
    if (previous === status) {
      return [];
    }
    this.toolStatus.set(callId, status);

    if (status === 'completed') {
      return [
        {
          type: 'tool_result',
          callId,
          tool,
          ok: true,
          ...(toolOutput(state) ? { output: toolOutput(state) } : {}),
        },
      ];
    }
    if (status === 'error') {
      return [
        {
          type: 'tool_result',
          callId,
          tool,
          ok: false,
          ...(toolOutput(state) ? { output: toolOutput(state) } : {}),
        },
      ];
    }
    if (previous === undefined) {
      return [
        {
          type: 'tool_call',
          callId,
          tool,
          ...(state.input !== undefined ? { input: state.input } : {}),
        },
      ];
    }
    return [];
  }

  private mapPermission(properties: Json): EngineEvent[] {
    if (readString(properties.sessionID) !== this.sessionId) {
      return [];
    }
    const permission = readString(properties.permission) ?? 'permission';
    const callId = readString(properties.id) ?? permission;
    return [
      {
        type: 'approval_required',
        callId,
        tool: permission,
        description: permission,
      },
    ];
  }

  private mapSessionError(properties: Json): EngineEvent[] {
    const sessionId = readString(properties.sessionID);
    if (sessionId && sessionId !== this.sessionId) {
      return [];
    }
    const error = isRecord(properties.error) ? properties.error : null;
    const name = readString(error?.name) ?? '';
    if (name === 'MessageAbortedError') {
      this.terminal = 'cancelled';
      return [{ type: 'cancelled', sessionId: this.sessionId }];
    }
    this.terminal = 'failed';
    return [
      {
        type: 'failed',
        sessionId: this.sessionId,
        code: 'provider_error',
        message:
          name === 'ProviderAuthError'
            ? 'The engine provider rejected its credentials.'
            : 'The engine reported an error.',
      },
    ];
  }

  private mapSessionIdle(type: string, properties: Json): EngineEvent[] {
    if (readString(properties.sessionID) !== this.sessionId || this.terminal) {
      return [];
    }
    if (type === 'session.status') {
      const status = isRecord(properties.status) ? properties.status : null;
      if (readString(status?.type) !== 'idle') {
        return [];
      }
    }
    this.terminal = 'completed';
    return [{ type: 'completed', sessionId: this.sessionId }];
  }

  private fileEdit(file: string): EngineEvent[] {
    if (this.filePaths.has(file)) {
      return [];
    }
    this.filePaths.add(file);
    return [{ type: 'file_edit', path: file }];
  }
}
