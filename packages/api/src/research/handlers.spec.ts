import type { Response } from 'express';
import { createResearchHandlers } from './handlers';

const researchId = '507f1f77bcf86cd799439011';

const source = {
  id: 'source-1',
  title: 'Primary filing',
  url: 'https://example.com/filing',
  publisher: 'Example',
  kind: 'primary' as const,
  excerpt: 'The filing states the figure.',
  note: '',
  retrievedAt: '2026-11-20',
};

const claim = {
  id: 'claim-1',
  text: 'The figure is 42.',
  status: 'supported' as const,
  sourceIds: ['source-1'],
};

const project = {
  _id: researchId,
  title: 'Free tool calling',
  question: 'Which providers still support it?',
  status: 'collecting' as const,
  revision: 3,
  sources: [source],
  claims: [claim],
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: 'owner', role: 'ADMIN', tenantId: 'tenant-a' },
    params: {},
    query: {},
    body: {},
    ...overrides,
  } as never;
}

function response() {
  const result = { statusCode: 200, body: undefined as unknown };
  const res = {
    status: jest.fn((statusCode: number) => {
      result.statusCode = statusCode;
      return res;
    }),
    json: jest.fn((body: unknown) => {
      result.body = body;
      return res;
    }),
  } as unknown as Response;
  return { res, result };
}

function setup(overrides: Partial<Parameters<typeof createResearchHandlers>[0]> = {}) {
  const deps = {
    listResearchProjects: jest.fn().mockResolvedValue({ projects: [project], nextCursor: null }),
    createResearchProject: jest
      .fn()
      .mockResolvedValue({ ok: true, project: { ...project, sources: [], claims: [] } }),
    getResearchProject: jest.fn().mockResolvedValue(project),
    saveResearchProject: jest
      .fn()
      .mockResolvedValue({ ok: true, project: { ...project, revision: 4 } }),
    deleteResearchProject: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
  return { handlers: createResearchHandlers(deps), deps };
}

const saveBody = (overrides: Record<string, unknown> = {}) => ({
  title: 'Free tool calling',
  question: 'Which providers still support it?',
  status: 'collecting',
  sources: [source],
  claims: [claim],
  expectedRevision: 3,
  ...overrides,
});

describe('Research handlers', () => {
  it('denies every surface to a non-owner account', async () => {
    const { handlers, deps } = setup();
    const { res, result } = response();

    await handlers.listProjects(request({ user: { id: 'member', role: 'USER' } }), res);

    expect(result.statusCode).toBe(403);
    expect(result.body).toEqual({ error: 'Research is owner-only', code: 'RESEARCH_OWNER_ONLY' });
    expect(deps.listResearchProjects).not.toHaveBeenCalled();
  });

  it('denies access when research is disabled in config', () => {
    const { handlers } = setup();
    const { res, result } = response();

    handlers.getCapabilities(request({ config: { research: { enabled: false } } }), res);

    expect(result.statusCode).toBe(403);
    expect(result.body).toEqual({ error: 'Research is disabled', code: 'RESEARCH_DISABLED' });
  });

  it('reports automated fetching and verification as unavailable', () => {
    const { handlers } = setup();
    const { res, result } = response();

    handlers.getCapabilities(request(), res);

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual(
      expect.objectContaining({
        ledger: true,
        automatedFetch: false,
        automatedVerification: false,
      }),
    );
  });

  it('returns the derived audit with a dossier', async () => {
    const { handlers } = setup();
    const { res, result } = response();

    await handlers.getProject(request({ params: { researchId } }), res);

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual(
      expect.objectContaining({
        _id: researchId,
        audit: expect.objectContaining({ sources: 1, claims: 1, ready: true }),
      }),
    );
  });

  it('rejects a claim that cites a source outside the dossier', async () => {
    const { handlers, deps } = setup();
    const { res, result } = response();

    await handlers.saveProject(
      request({
        params: { researchId },
        body: saveBody({ claims: [{ ...claim, sourceIds: ['gone'] }] }),
      }),
      res,
    );

    expect(result.statusCode).toBe(400);
    expect(deps.saveResearchProject).not.toHaveBeenCalled();
  });

  it('rejects a non-http source URL', async () => {
    const { handlers } = setup();
    const { res, result } = response();

    await handlers.saveProject(
      request({
        params: { researchId },
        body: saveBody({ sources: [{ ...source, url: 'javascript:alert(1)' }] }),
      }),
      res,
    );

    expect(result.statusCode).toBe(400);
    expect(result.body).toEqual({ error: 'sources[0].url must be an http(s) URL' });
  });

  it('refuses to mark a ledger complete while a claim has no citation', async () => {
    const { handlers, deps } = setup();
    const { res, result } = response();

    await handlers.saveProject(
      request({
        params: { researchId },
        body: saveBody({ status: 'complete', claims: [{ ...claim, sourceIds: [] }] }),
      }),
      res,
    );

    expect(result.statusCode).toBe(409);
    expect(result.body).toEqual(expect.objectContaining({ code: 'RESEARCH_NOT_READY' }));
    expect(deps.saveResearchProject).not.toHaveBeenCalled();
  });

  it('saves a fully cited ledger and returns its revision', async () => {
    const { handlers, deps } = setup();
    const { res, result } = response();

    await handlers.saveProject(
      request({ params: { researchId }, body: saveBody({ status: 'complete' }) }),
      res,
    );

    expect(result.statusCode).toBe(200);
    expect(deps.saveResearchProject).toHaveBeenCalledWith(
      'owner',
      researchId,
      expect.objectContaining({ status: 'complete' }),
      3,
    );
    expect(result.body).toEqual(expect.objectContaining({ revision: 4 }));
  });

  it('maps a stale revision to a conflict and a missing dossier to 404', async () => {
    const conflict = setup({
      saveResearchProject: jest.fn().mockResolvedValue({ ok: false, code: 'CONFLICT', project }),
    });
    const conflictResponse = response();
    await conflict.handlers.saveProject(
      request({ params: { researchId }, body: saveBody() }),
      conflictResponse.res,
    );
    expect(conflictResponse.result.statusCode).toBe(409);
    expect(conflictResponse.result.body).toEqual({
      error: 'Research dossier was changed by another session',
      code: 'RESEARCH_REVISION_CONFLICT',
    });

    const missing = setup({
      getResearchProject: jest.fn().mockResolvedValue(null),
      deleteResearchProject: jest.fn().mockResolvedValue(false),
    });
    const missingResponse = response();
    await missing.handlers.deleteProject(request({ params: { researchId } }), missingResponse.res);
    expect(missingResponse.result.statusCode).toBe(404);
  });
});
