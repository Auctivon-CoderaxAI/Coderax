import { hasMalformedWorkAgentId, isValidWorkId, selectedWorkAgentId } from './ids';

describe('Work ID validation', () => {
  it('accepts IDs up to the shared maximum length', () => {
    const id = 'a'.repeat(200);
    expect(isValidWorkId(id)).toBe(true);
    expect(selectedWorkAgentId({ agent_id: id }, 'ephemeral')).toBe(id);
  });

  it('rejects malformed or oversized agent IDs consistently', () => {
    const id = 'a'.repeat(201);
    expect(isValidWorkId(id)).toBe(false);
    expect(hasMalformedWorkAgentId({ agent_id: id }, 'ephemeral')).toBe(true);
    expect(selectedWorkAgentId({ agent_id: id }, 'ephemeral')).toBeNull();
  });

  it('does not treat the ephemeral agent sentinel as a selected agent', () => {
    expect(hasMalformedWorkAgentId({ agent_id: 'ephemeral' }, 'ephemeral')).toBe(false);
    expect(selectedWorkAgentId({ agent_id: 'ephemeral' }, 'ephemeral')).toBeNull();
  });
});
