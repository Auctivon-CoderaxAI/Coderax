import express from 'express';
import request from 'supertest';
import type { Application } from 'express';
import { createWorkRouter } from './router';
import type { WorkDeps } from './router';

type Stored = { conversationId: string; title?: string; metadata: Record<string, unknown> };

function app(deps: Partial<WorkDeps> & { user?: { id: string } | null } = {}): Application {
  const conversations: Stored[] = [];
  const full: WorkDeps = {
    listModels: async () => [{ id: 'llama3:latest', local: true }],
    listConversations: async ({ userId }) =>
      conversations.filter((c) => c.metadata.owner === userId) as never,
    getConversation: async ({ conversationId }) =>
      (conversations.find((c) => c.conversationId === conversationId) ?? null) as never,
    createConversation: async ({ userId, title, metadata }) => {
      const stored = {
        conversationId: `c-${conversations.length + 1}`,
        title,
        metadata: { ...metadata, owner: userId },
      };
      conversations.push(stored);
      return stored as never;
    },
    appendTurn: async () => undefined,
    cancelRun: async () => true,
    ...deps,
  };
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    if (deps.user === null) return next();
    (req as never as { user: { id: string } }).user = deps.user ?? { id: 'user-a' };
    next();
  });
  server.use('/api/work', createWorkRouter(full));
  return server;
}

describe('native Work router', () => {
  it('rejects unauthenticated requests instead of falling back to a shared identity', async () => {
    const res = await request(app({ user: null })).get('/api/work/tasks');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('WORK_UNAUTHENTICATED');
  });

  it('serves models from the injected native source only', async () => {
    const res = await request(app()).get('/api/work/models');
    expect(res.status).toBe(200);
    expect(res.body.models).toEqual([{ id: 'llama3:latest', label: 'llama3:latest' }]);
  });

  it('creates a conversation-backed task and lists it as history', async () => {
    const server = app();
    const created = await request(server).post('/api/work/tasks').send({ task: 'Plan the launch' });
    expect(created.status).toBe(201);
    expect(created.body.task).toMatchObject({ title: 'Plan the launch', state: 'unknown' });

    const list = await request(server).get('/api/work/tasks');
    expect(list.body.tasks).toHaveLength(1);
  });

  it('refuses a model that is not offered instead of silently substituting one', async () => {
    const res = await request(app())
      .post('/api/work/tasks')
      .send({ task: 'Plan', model: 'openai:gpt-4o' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('WORK_MODEL_UNAVAILABLE');
  });

  it('rejects empty tasks', async () => {
    const res = await request(app()).post('/api/work/tasks').send({ task: '  ' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('WORK_INVALID_TASK');
  });

  it('does not expose another tenant’s task', async () => {
    const deps: Partial<WorkDeps> = {
      getConversation: async () => null,
    };
    const res = await request(app(deps)).get('/api/work/tasks/c-1');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('WORK_TASK_NOT_FOUND');
  });

  it('accepts a follow-up turn on an existing task', async () => {
    const server = app();
    const created = await request(server).post('/api/work/tasks').send({ task: 'Plan' });
    const id = created.body.task.id;
    const res = await request(server)
      .post(`/api/work/tasks/${id}/messages`)
      .send({ message: 'Go on' });
    expect(res.status).toBe(202);
  });

  it('cancels an active task and refuses a second cancel', async () => {
    const server = app();
    const created = await request(server).post('/api/work/tasks').send({ task: 'Plan' });
    const id = created.body.task.id;
    const first = await request(server).post(`/api/work/tasks/${id}/cancel`);
    expect(first.status).toBe(202);
    expect(first.body.canceled).toBe(true);
  });

  it('reports a failed cancel instead of claiming success', async () => {
    const server = app({ cancelRun: async () => false });
    const created = await request(server).post('/api/work/tasks').send({ task: 'Plan' });
    const res = await request(server).post(`/api/work/tasks/${created.body.task.id}/cancel`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('WORK_NOTHING_TO_CANCEL');
  });

  it('surfaces history failures as an outage, not an empty list', async () => {
    const server = app({
      listConversations: async () => {
        throw new Error('db down');
      },
    });
    const res = await request(server).get('/api/work/tasks');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('WORK_HISTORY_UNAVAILABLE');
  });
});
