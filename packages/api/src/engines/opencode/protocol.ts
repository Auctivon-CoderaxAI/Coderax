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

/**
 * A tool's arguments only exist once they are non-empty: the `pending` state
 * reports `input: {}` before the model's arguments have been parsed, and a
 * later state carries the real ones.
 */
function hasArguments(input: unknown): boolean {
  return isRecord(input) ? Object.keys(input).length > 0 : input != null;
}

export class OpenCodeEventMapper {
  private readonly sessionId: string;
  /** Text emitted for each part, reconciled across cumulative and delta forms. */
  private readonly emittedText = new Map<string, string>();
  /** First-seen order for composing replacement snapshots across parts. */
  private readonly textOrder: string[] = [];
  /** Calls already reported, and calls whose result has been: OpenCode
   *  repeats a part's whole state, so each is emitted once. */
  private readonly publishedCalls = new Set<string>();
  private readonly settledCalls = new Set<string>();
  private readonly filePaths = new Set<string>();
  /** Roles reported by message.updated: a session streams every part, including
   *  the prompt the user sent, and only assistant text may reach the reply. */
  private readonly messageRoles = new Map<string, string>();
  private readonly userTextParts = new Set<string>();
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
      case 'message.updated':
        return this.mapMessageUpdate(properties);
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

  private fullText(): string {
    return this.textOrder.map((id) => this.emittedText.get(id) ?? '').join('');
  }

  private mapMessageUpdate(properties: Json): EngineEvent[] {
    const info = isRecord(properties.info) ? properties.info : null;
    if (!info || readString(info.sessionID) !== this.sessionId) {
      return [];
    }
    const id = readString(info.id);
    const role = readString(info.role);
    if (id && role) {
      this.messageRoles.set(id, role);
    }
    return [];
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
      const messageId = readString(part.messageID) ?? readString(properties.messageID);
      if (messageId && this.messageRoles.get(messageId) === 'user') {
        this.userTextParts.add(id);
        return [];
      }
      const emitted = this.emittedText.get(id) ?? '';
      if (text === emitted) {
        return [];
      }
      if (!this.emittedText.has(id)) {
        this.textOrder.push(id);
      }
      this.emittedText.set(id, text);
      if (text.startsWith(emitted)) {
        const delta = text.slice(emitted.length);
        return delta ? [{ type: 'text_delta', text: delta }] : [];
      }
      // A cumulative part may replace text that was already sent. Send the
      // complete snapshot so consumers replace what they have, not append a tail.
      return [{ type: 'text_replace', text: this.fullText() }];
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
    const messageId = readString(properties.messageID);
    if (
      this.userTextParts.has(partId) ||
      (messageId && this.messageRoles.get(messageId) === 'user')
    ) {
      return [];
    }
    if (!this.emittedText.has(partId)) {
      this.textOrder.push(partId);
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
    const tool = toolName(part);
    const status = readString(state.status) ?? 'unknown';
    const terminal = status === 'completed' || status === 'error';
    const input = hasArguments(state.input) ? state.input : undefined;

    const events: EngineEvent[] = [];
    /** Publish the call once its arguments are known, or when it settles
     *  without ever reporting them, so a result never precedes its call. */
    if (!this.publishedCalls.has(callId) && (input !== undefined || terminal)) {
      this.publishedCalls.add(callId);
      events.push({
        type: 'tool_call',
        callId,
        tool,
        ...(input !== undefined ? { input } : {}),
      });
    }
    if (terminal && !this.settledCalls.has(callId)) {
      this.settledCalls.add(callId);
      const output = toolOutput(state);
      events.push({
        type: 'tool_result',
        callId,
        tool,
        ok: status === 'completed',
        ...(output ? { output } : {}),
      });
    }
    return events;
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
