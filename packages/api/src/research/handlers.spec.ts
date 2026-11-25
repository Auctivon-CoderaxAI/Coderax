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

  it('reads the research block from the nested resolved config', async () => {
    const { handlers, deps } = setup();
    const { res, result } = response();

    await handlers.listProjects(
      request({ config: { config: { research: { enabled: false } } } }),
      res,
    );

    expect(result.statusCode).toBe(403);
    expect(result.body).toEqual({ error: 'Research is disabled', code: 'RESEARCH_DISABLED' });
    expect(deps.listResearchProjects).not.toHaveBeenCalled();
  });

  it('passes the configured limits from the nested config to storage', async () => {
    const { handlers, deps } = setup();
    const { res } = response();

    await handlers.createProject(
      request({
        config: { config: { research: { maxProjectsPerOwner: 3 } } },
        body: { title: 'One' },
      }),
      res,
    );

    expect(deps.createResearchProject).toHaveBeenCalledWith(
      'owner',
      expect.objectContaining({ title: 'One' }),
      { maxProjectsPerOwner: 3 },
    );
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
        enabled: true,
        ownerOnly: true,
        canAccess: true,
      }),
    );
  });

  it('reports the effective policy to an account that may not open dossiers', () => {
    const { handlers } = setup();
    const { res, result } = response();

    handlers.getCapabilities(request({ user: { id: 'member', role: 'USER' } }), res);

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual(
      expect.objectContaining({ ownerOnly: true, enabled: true, canAccess: false }),
    );
  });

  it('admits non-admin accounts when the deployment disables ownerOnly', async () => {
    const { handlers, deps } = setup();
    const { res, result } = response();

    await handlers.listProjects(
      request({
        user: { id: 'member', role: 'USER' },
        config: { config: { research: { ownerOnly: false } } },
      }),
      res,
    );

    expect(result.statusCode).toBe(200);
    expect(deps.listResearchProjects).toHaveBeenCalledWith('member', expect.any(Object));
  });

  it('maps a read-only completed dossier to its own conflict code', async () => {
    const { handlers } = setup({
      saveResearchProject: jest.fn().mockResolvedValue({ ok: false, code: 'READ_ONLY', project }),
    });
    const { res, result } = response();

    await handlers.saveProject(
      request({ params: { researchId }, body: saveBody({ status: 'complete' }) }),
      res,
    );

    expect(result.statusCode).toBe(409);
    expect(result.body).toEqual({
      error: 'Completed research dossiers are read-only until reopened',
      code: 'RESEARCH_READ_ONLY',
    });
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

  it('rejects malformed save input and dossier ids before storage', async () => {
    const { handlers, deps } = setup();

    const badRevision = response();
    await handlers.saveProject(
      request({ params: { researchId }, body: saveBody({ expectedRevision: '3' }) }),
      badRevision.res,
    );
    expect(badRevision.result.statusCode).toBe(400);

    const badSources = response();
    await handlers.saveProject(
      request({ params: { researchId }, body: saveBody({ sources: 'nope' }) }),
      badSources.res,
    );
    expect(badSources.result.statusCode).toBe(400);

    const badId = response();
    await handlers.getProject(request({ params: { researchId: 'not-an-object-id' } }), badId.res);
    expect(badId.result.statusCode).toBe(404);

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
