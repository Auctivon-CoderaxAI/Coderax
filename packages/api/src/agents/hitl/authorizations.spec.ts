import express from 'express';
import request from 'supertest';
import type {
  ToolStandingAuthorization,
  ToolStandingAuthorizationStorage,
} from 'coderax-data-provider';
import { createToolStandingAuthorizationControllers } from './authorizations';

const owner = { id: 'owner-1', role: 'ADMIN' };

const grant = (overrides: Partial<ToolStandingAuthorization> = {}): ToolStandingAuthorization => ({
  id: 'standing-1',
  label: 'Zero-cost reads',
  tools: ['read_*'],
  createdAt: 1,
  maxCostUsd: 0,
  ...overrides,
});

function fixture(user: { id?: string; role?: string; tenantId?: string } | null = owner) {
  const storage: Pick<
    ToolStandingAuthorizationStorage,
    | 'listToolStandingAuthorizations'
    | 'createToolStandingAuthorization'
    | 'revokeToolStandingAuthorization'
  > = {
    listToolStandingAuthorizations: jest.fn(async () => [grant()]),
    createToolStandingAuthorization: jest.fn(async () => ({ ok: true as const, value: grant() })),
    revokeToolStandingAuthorization: jest.fn(async () => true),
  };
  const controllers = createToolStandingAuthorizationControllers({ storage });
  const app = express();
  app.use(express.json());
  app.get('/authorizations', (req, res) =>
    controllers.list(Object.assign(req, { user: user ?? undefined }), res),
  );
  app.post('/authorizations', (req, res) =>
    controllers.create(Object.assign(req, { user: user ?? undefined }), res),
  );
  app.delete('/authorizations/:authorizationId', (req, res) =>
    controllers.revoke(Object.assign(req, { user: user ?? undefined }), res),
  );
  return { storage, app };
}

describe('standing authorization endpoints', () => {
  test('rejects anonymous and non-owner callers before touching storage', async () => {
    for (const user of [null, { id: 'user-1', role: 'USER' }, { id: 'user-1' }]) {
      const { app, storage } = fixture(user);
      await expect(request(app).get('/authorizations')).resolves.toMatchObject({
        status: user == null ? 401 : 403,
      });
      await expect(
        request(app)
          .post('/authorizations')
          .send({ label: 'Reads', tools: ['read_*'] }),
      ).resolves.toMatchObject({ status: user == null ? 401 : 403 });
      expect(storage.listToolStandingAuthorizations).not.toHaveBeenCalled();
      expect(storage.createToolStandingAuthorization).not.toHaveBeenCalled();
    }
  });

  test('lists only the caller’s grants, scoped by tenant when present', async () => {
    const { app, storage } = fixture({ ...owner, tenantId: 'tenant-1' });
    const response = await request(app).get('/authorizations');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ authorizations: [grant()] });
    expect(storage.listToolStandingAuthorizations).toHaveBeenCalledWith({
      userId: 'owner-1',
      tenantId: 'tenant-1',
    });
  });

  test('creates a grant for the caller and returns it', async () => {
    const { app, storage } = fixture();
    const body = { label: 'Reads', tools: ['read_*'], expiresAt: 4_000_000_000_000 };
    const response = await request(app).post('/authorizations').send(body);
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ authorization: grant() });
    expect(storage.createToolStandingAuthorization).toHaveBeenCalledWith(
      { userId: 'owner-1' },
      body,
    );
  });

  test('refuses malformed bodies without calling the store', async () => {
    const { app, storage } = fixture();
    for (const body of [
      {},
      { label: 'Reads' },
      { label: 'Reads', tools: [] },
      { label: 'Reads', tools: ['read_*'], extra: true },
      { label: 'Reads', tools: ['read_*'], maxCostUsd: 'free' },
    ]) {
      const response = await request(app).post('/authorizations').send(body);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ code: 'INVALID_STANDING_AUTHORIZATION' });
    }
    expect(storage.createToolStandingAuthorization).not.toHaveBeenCalled();
  });

  test('surfaces the store’s refusal, such as a non-zero ceiling', async () => {
    const { app, storage } = fixture();
    jest.mocked(storage.createToolStandingAuthorization).mockResolvedValueOnce({
      ok: false,
      error: { code: 'cost', message: 'A standing authorization cannot cover spending.' },
    });
    const response = await request(app)
      .post('/authorizations')
      .send({ label: 'Reads', tools: ['read_*'], maxCostUsd: 5 });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      code: 'INVALID_STANDING_AUTHORIZATION',
      detail: 'A standing authorization cannot cover spending.',
    });
  });

  test('revokes by id within the caller’s scope', async () => {
    const { app, storage } = fixture();
    const response = await request(app).delete('/authorizations/standing-1');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ revoked: true });
    expect(storage.revokeToolStandingAuthorization).toHaveBeenCalledWith(
      { userId: 'owner-1' },
      'standing-1',
    );
  });

  test('answers 404 for a grant the caller does not own or that is already revoked', async () => {
    const { app, storage } = fixture();
    jest.mocked(storage.revokeToolStandingAuthorization).mockResolvedValueOnce(false);
    const response = await request(app).delete('/authorizations/elsewhere');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ code: 'STANDING_AUTHORIZATION_NOT_FOUND' });
  });

  test('reports a store failure as unavailable rather than as success', async () => {
    const { app, storage } = fixture();
    jest.mocked(storage.listToolStandingAuthorizations).mockRejectedValueOnce(new Error('db down'));
    jest
      .mocked(storage.createToolStandingAuthorization)
      .mockRejectedValueOnce(new Error('db down'));
    jest
      .mocked(storage.revokeToolStandingAuthorization)
      .mockRejectedValueOnce(new Error('db down'));

    expect((await request(app).get('/authorizations')).status).toBe(503);
    expect(
      (
        await request(app)
          .post('/authorizations')
          .send({ label: 'Reads', tools: ['read_*'] })
      ).status,
    ).toBe(503);
    expect((await request(app).delete('/authorizations/standing-1')).status).toBe(503);
  });
});
