import { SystemRoles } from 'coderax-data-provider';
import type { EngineWorkChatConfig } from './types';
import type { Json } from './json';

/** The deployment flag is the only switch; the role check is always applied. */
export function isOwnerEngineWorkChat(input: {
  config?: EngineWorkChatConfig | null;
  user?: { role?: unknown } | null;
  body?: Json | null;
}): boolean {
  if (input.config?.engines?.workChat?.enabled !== true) {
    return false;
  }
  if (input.user?.role !== SystemRoles.ADMIN) {
    return false;
  }
  const body = input.body ?? {};
  return (
    body.agent_id == null &&
    body.agentId == null &&
    body.ephemeralAgent == null &&
    body.spec == null
  );
}

export function isEngineWorkChatPath(path: string): boolean {
  return path === '/chat' || path === '/chat/' || path === '/chat/agents';
}
