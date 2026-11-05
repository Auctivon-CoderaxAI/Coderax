export const WORK_ID_MAX_LENGTH = 200;

const WORK_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isValidWorkId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= WORK_ID_MAX_LENGTH &&
    WORK_ID_PATTERN.test(value)
  );
}

function agentIdFromBody(body: unknown): unknown {
  return body != null && typeof body === 'object' && 'agent_id' in body ? body.agent_id : undefined;
}

export function selectedWorkAgentId(body: unknown, ephemeralAgentId: string): string | null {
  const agentId = agentIdFromBody(body);
  if (
    typeof agentId !== 'string' ||
    !agentId ||
    agentId === ephemeralAgentId ||
    !isValidWorkId(agentId)
  ) {
    return null;
  }
  return agentId;
}

export function hasMalformedWorkAgentId(body: unknown, ephemeralAgentId: string): boolean {
  const agentId = agentIdFromBody(body);
  return (
    agentId != null && agentId !== '' && agentId !== ephemeralAgentId && !isValidWorkId(agentId)
  );
}
