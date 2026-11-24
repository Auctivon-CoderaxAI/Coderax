import { GAME_TEMPLATES } from 'coderax-data-provider';
import type { Response } from 'express';
import { createGameHandlers } from './handlers';

const gameId = '507f1f77bcf86cd799439011';

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

function setup(overrides: Partial<Parameters<typeof createGameHandlers>[0]> = {}) {
  const deps = {
    listGameProjects: jest
      .fn()
      .mockResolvedValue({ projects: [{ _id: gameId, name: 'Lantern Run' }], nextCursor: null }),
    createGameProject: jest.fn().mockResolvedValue({ ok: true, project: { _id: gameId } }),
    getGameProject: jest.fn().mockResolvedValue({ _id: gameId, revision: 1 }),
    updateGameProject: jest.fn().mockResolvedValue({ _id: gameId, revision: 2 }),
    saveGameSpec: jest.fn().mockResolvedValue({ ok: true, project: { _id: gameId, revision: 2 } }),
    deleteGameProject: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
  return { handlers: createGameHandlers(deps), deps };
}

const validSpec = {
  prompt: 'A side-view platformer about relighting beacons.',
  genre: 'platformer',
  camera: 'side_view',
  players: 1,
  coreLoop: 'Jump and light beacons.',
  winCondition: 'Light every beacon.',
  artDirection: 'Muted dusk palette.',
};

describe('Game Studio handlers', () => {
  it('denies every surface to a non-owner account', async () => {
    const { handlers, deps } = setup();
    const { res, result } = response();

    await handlers.listProjects(request({ user: { id: 'member', role: 'USER' } }), res);

    expect(result.statusCode).toBe(403);
    expect(result.body).toEqual({ error: 'Game Studio is owner-only', code: 'GAMES_OWNER_ONLY' });
    expect(deps.listGameProjects).not.toHaveBeenCalled();
  });

  it('denies access when the capability is disabled in config', async () => {
    const { handlers } = setup();
    const { res, result } = response();

    handlers.getCapabilities(request({ config: { games: { enabled: false } } }), res);

    expect(result.statusCode).toBe(403);
    expect(result.body).toEqual({ error: 'Game Studio is disabled', code: 'GAMES_DISABLED' });
  });

  it('reports builds, playtests and agent sessions as unavailable', () => {
    const { handlers } = setup();
    const { res, result } = response();

    handlers.getCapabilities(request(), res);

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      executor: 'unavailable',
      builds: false,
      playtests: false,
      agentSessions: false,
    });
  });

  it('lists the owner’s projects', async () => {
    const { handlers, deps } = setup();
    const { res, result } = response();

    await handlers.listProjects(request({ query: { search: 'lantern' } }), res);

    expect(result.statusCode).toBe(200);
    expect(deps.listGameProjects).toHaveBeenCalledWith(
      'owner',
      expect.objectContaining({ search: 'lantern' }),
    );
  });

  it('rejects a create without a name before persistence', async () => {
    const { handlers, deps } = setup();
    const { res, result } = response();

    await handlers.createProject(request({ body: { name: '   ' } }), res);

    expect(result.statusCode).toBe(400);
    expect(deps.createGameProject).not.toHaveBeenCalled();
  });

  it('seeds a new project from an original-IP template', async () => {
    const { handlers, deps } = setup();
    const { res, result } = response();
    const template = GAME_TEMPLATES[0];

    await handlers.createProject(
      request({ body: { name: 'Lantern Run', templateId: template.id } }),
      res,
    );

    expect(result.statusCode).toBe(201);
    expect(deps.createGameProject).toHaveBeenCalledWith(
      'owner',
      expect.objectContaining({
        name: 'Lantern Run',
        spec: expect.objectContaining({ genre: template.spec.genre }),
      }),
      expect.any(Object),
    );
  });

  it('reports a project limit as a conflict instead of a server error', async () => {
    const { handlers } = setup({
      createGameProject: jest.fn().mockResolvedValue({ ok: false, code: 'LIMIT_REACHED' }),
    });
    const { res, result } = response();

    await handlers.createProject(request({ body: { name: 'One more' } }), res);

    expect(result.statusCode).toBe(409);
    expect(result.body).toEqual({
      error: 'Game project limit reached',
      code: 'GAME_PROJECT_LIMIT_REACHED',
    });
  });

  it('returns 404 for an unknown game id instead of touching persistence', async () => {
    const { handlers, deps } = setup();
    const { res, result } = response();

    await handlers.getProject(request({ params: { gameId: 'not-an-object-id' } }), res);

    expect(result.statusCode).toBe(404);
    expect(deps.getGameProject).not.toHaveBeenCalled();
  });

  it('validates the spec before saving', async () => {
    const { handlers, deps } = setup();
    const { res, result } = response();

    await handlers.saveSpec(
      request({
        params: { gameId },
        body: { spec: { ...validSpec, players: 3 }, expectedRevision: 1 },
      }),
      res,
    );

    expect(result.statusCode).toBe(400);
    expect(deps.saveGameSpec).not.toHaveBeenCalled();
  });

  it('rejects a missing expected revision', async () => {
    const { handlers, deps } = setup();
    const { res, result } = response();

    await handlers.saveSpec(request({ params: { gameId }, body: { spec: validSpec } }), res);

    expect(result.statusCode).toBe(400);
    expect(deps.saveGameSpec).not.toHaveBeenCalled();
  });

  it('saves a valid spec with the revision it was based on', async () => {
    const { handlers, deps } = setup();
    const { res, result } = response();

    await handlers.saveSpec(
      request({ params: { gameId }, body: { spec: validSpec, expectedRevision: 1 } }),
      res,
    );

    expect(result.statusCode).toBe(200);
    expect(deps.saveGameSpec).toHaveBeenCalledWith(
      'owner',
      gameId,
      expect.objectContaining({ prompt: validSpec.prompt }),
      1,
    );
  });

  it('maps a stale spec revision to a 409 conflict code', async () => {
    const { handlers } = setup({
      saveGameSpec: jest.fn().mockResolvedValue({ ok: false, code: 'CONFLICT' }),
    });
    const { res, result } = response();

    await handlers.saveSpec(
      request({ params: { gameId }, body: { spec: validSpec, expectedRevision: 1 } }),
      res,
    );

    expect(result.statusCode).toBe(409);
    expect(result.body).toEqual({
      error: 'Game spec was changed by another session',
      code: 'GAME_REVISION_CONFLICT',
    });
  });
});
