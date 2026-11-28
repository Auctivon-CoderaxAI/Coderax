import {
  CODERAX_API_CONTRACT,
  CODERAX_API_VERSION,
  apiMajor,
  describeApiContract,
  isSupportedApiVersion,
  shouldRejectApiRequest,
} from './apiContract';

describe('API contract', () => {
  it('advertises a version and the capabilities a client can rely on', () => {
    expect(CODERAX_API_CONTRACT.apiVersion).toBe(CODERAX_API_VERSION);
    expect(CODERAX_API_CONTRACT.capabilities.work.chat.eventIds).toBe(true);
    expect(CODERAX_API_CONTRACT.capabilities.work.chat.idempotency).toContain('Idempotency-Key');
    expect(CODERAX_API_CONTRACT.capabilities.workflows.runStream.eventIds).toBe(true);
    expect(CODERAX_API_CONTRACT.capabilities.workflows.runStream.resume).toBe('Last-Event-ID');
  });

  it('declares the repository inventory absent instead of leaving a client to probe it', () => {
    expect(CODERAX_API_CONTRACT.capabilities.repos.list).toBe(false);
    expect(CODERAX_API_CONTRACT.capabilities.repos.reason.length).toBeGreaterThan(0);
  });

  it('reports the deployment commit and generation time it was asked for', () => {
    const metadata = describeApiContract({
      commit: 'abc123',
      now: new Date('2026-01-02T03:04:05Z'),
    });

    expect(metadata.commit).toBe('abc123');
    expect(metadata.generatedAt).toBe('2026-01-02T03:04:05.000Z');
    expect(metadata.apiVersion).toBe(CODERAX_API_VERSION);
    expect(metadata.name).toBe('coderax-workflow-api');
  });

  it('reports no commit rather than inventing one', () => {
    expect(describeApiContract().commit).toBeNull();
  });
});

describe('API version negotiation', () => {
  it('reads a major from a bare, dotted or suffixed version', () => {
    expect(apiMajor('1')).toBe(1);
    expect(apiMajor('1.4.2')).toBe(1);
    expect(apiMajor('1-beta')).toBe(1);
    expect(apiMajor(2)).toBe(2);
    expect(apiMajor('v1')).toBeNull();
    expect(apiMajor(undefined)).toBeNull();
  });

  it('accepts the server major and refuses another', () => {
    expect(isSupportedApiVersion('1.9.9')).toBe(true);
    expect(isSupportedApiVersion('2')).toBe(false);
  });

  it('rejects a write from another major before it can change anything', () => {
    expect(shouldRejectApiRequest('POST', '2')).toBe(true);
    expect(shouldRejectApiRequest('DELETE', '2.0.0')).toBe(true);
    expect(shouldRejectApiRequest('POST', '1.9.9')).toBe(false);
  });

  it('accepts an unversioned legacy client', () => {
    expect(shouldRejectApiRequest('POST', undefined)).toBe(false);
    expect(shouldRejectApiRequest('POST', '')).toBe(false);
  });

  it('never blocks a read, so a client can read the version it failed against', () => {
    expect(shouldRejectApiRequest('GET', '99')).toBe(false);
  });

  it('fails closed on a present but unparseable version', () => {
    expect(shouldRejectApiRequest('PATCH', 'latest')).toBe(true);
  });
});
