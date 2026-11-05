import express from 'express';
import request from 'supertest';
import type { Application } from 'express';
import type { WorkConversation } from './task';
import type { WorkDeps } from './router';
import { createWorkRouter } from './router';

type Stored = WorkConversation & { userId: string };

function app(deps: Partial<WorkDeps> & { user?: { id: string } | null } = {}): Application {
  const conversations: Stored[] = [
    { conversationId: 'c-1', title: 'Plan', isWork: true, userId: 'user-a' },
    { conversationId: 'c-2', title: 'Other chat', isWork: false, userId: 'user-a' },
    { conversationId: 'c-3', title: 'Someone else', isWork: true, userId: 'user-b' },
  ];
  const full: WorkDeps = {
    listModels: async () => [
      { id: 'llama3:latest', local: true },
      { id: 'openai:gpt-4o', provider: 'gateway' },
    ],
    configuredDefaultModel: async () => 'llama3:latest',
    listConversations: async ({ userId }) =>
      conversations.filter((c) => c.userId === userId && c.isWork === true),
    getConversation: async ({ userId, conversationId }) =>
      conversations.find((c) => c.userId === userId && c.conversationId === conversationId) ?? null,
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

  it('serves native models with the automatic choice first', async () => {
    const res = await request(app()).get('/api/work/models');
    expect(res.status).toBe(200);
    expect(res.body.models.map((model: { id: string }) => model.id)).toEqual([
      'auto',
      'llama3:latest',
    ]);
  });

  it('does not offer a model catalog it cannot read', async () => {
    const res = await request(
      app({
        listModels: async () => {
          throw new Error('model catalog down');
        },
      }),
    ).get('/api/work/models');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('WORK_MODELS_UNAVAILABLE');
  });

  it('applies the configured graph-size limit to agent listings', async () => {
    const res = await request(
      app({
        listModels: async () => [{ id: 'llama3:latest', provider: 'ollama', local: true }],
        agentGraphLimit: 1,
        listAgents: async () => [
          {
            id: 'root',
            model: 'llama3:latest',
            provider: 'ollama',
            agent_ids: ['child'],
          },
          {
            id: 'child',
            model: 'llama3:latest',
            provider: 'ollama',
          },
        ],
      }),
    ).get('/api/work/agents');

    expect(res.status).toBe(200);
    expect(res.body.agents.map((agent: { id: string }) => agent.id)).toEqual(['child']);
  });

  it('has no task-start route, so a run can only begin through native chat', async () => {
    const res = await request(app()).post('/api/work/tasks').send({ task: 'Plan' });
    expect(res.status).toBe(404);
  });

  it('has no follow-up route of its own', async () => {
    const res = await request(app())
      .post('/api/work/tasks/c-1/messages')
      .send({ message: 'Go on' });
    expect(res.status).toBe(404);
  });

  it('lists only this owner’s marked Work conversations', async () => {
    const res = await request(app()).get('/api/work/tasks');
    expect(res.status).toBe(200);
    expect(res.body.tasks.map((task: { id: string }) => task.id)).toEqual(['c-1']);
    expect(res.body.tasks[0].state).toBe('unknown');
  });

  it('uses live native job state and clears a stale running marker', async () => {
    const server = app({
      listConversations: async () => [
        { conversationId: 'c-1', title: 'Plan', isWork: true, workState: 'running' },
      ],
      getRunState: async () => 'complete',
    });
    const res = await request(server).get('/api/work/tasks');
    expect(res.status).toBe(200);
    expect(res.body.tasks[0].state).toBe('completed');
  });

  it('reports unknown when an old running row has no live registry job', async () => {
    const server = app({
      listConversations: async () => [
        { conversationId: 'c-1', title: 'Plan', isWork: true, workState: 'running' },
      ],
      getRunState: async () => null,
    });
    const res = await request(server).get('/api/work/tasks');
    expect(res.status).toBe(200);
    expect(res.body.tasks[0].state).toBe('unknown');
  });

  it('does not list another tenant’s Work conversation', async () => {
    const res = await request(app()).get('/api/work/tasks');
    expect(res.body.tasks.map((task: { id: string }) => task.id)).not.toContain('c-3');
  });

  it('does not expose another tenant’s task by id', async () => {
    const res = await request(app()).get('/api/work/tasks/c-3');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('WORK_TASK_NOT_FOUND');
  });

  it('does not expose a non-Work conversation as a task', async () => {
    const res = await request(app()).get('/api/work/tasks/c-2');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('WORK_TASK_NOT_FOUND');
  });

  it('reports the persisted terminal state rather than inventing running', async () => {
    const server = app({
      getConversation: async () => ({
        conversationId: 'c-1',
        title: 'Plan',
        isWork: true,
        workState: 'completed',
      }),
    });
    const res = await request(server).get('/api/work/tasks/c-1');
    expect(res.status).toBe(200);
    expect(res.body.task.state).toBe('completed');
  });

  it('reports a task store failure instead of disguising it as not found', async () => {
    const server = app({
      getConversation: async () => {
        throw new Error('db down');
      },
    });
    const res = await request(server).get('/api/work/tasks/c-1');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('WORK_TASK_UNAVAILABLE');
  });

  it('cancels through the native abort and reports nothing left to cancel', async () => {
    let active = true;
    const server = app({
      cancelRun: async () => {
        if (!active) return false;
        active = false;
        return true;
      },
    });
    const first = await request(server).post('/api/work/tasks/c-1/cancel');
    const second = await request(server).post('/api/work/tasks/c-1/cancel');
    expect(first.status).toBe(202);
    expect(first.body.canceled).toBe(true);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('WORK_NOTHING_TO_CANCEL');
  });

  it('refuses to cancel a task that already finished', async () => {
    const server = app({
      getConversation: async () => ({
        conversationId: 'c-1',
        title: 'Plan',
        isWork: true,
        workState: 'aborted',
      }),
    });
    const res = await request(server).post('/api/work/tasks/c-1/cancel');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('WORK_TASK_ALREADY_FINISHED');
  });

  it('refuses cancellation when the live native job is already complete', async () => {
    const cancelRun = jest.fn(async () => true);
    const server = app({ getRunState: async () => 'complete', cancelRun });
    const res = await request(server).post('/api/work/tasks/c-1/cancel');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('WORK_TASK_ALREADY_FINISHED');
    expect(cancelRun).not.toHaveBeenCalled();
  });

  it('reports a cancel service failure as unavailable', async () => {
    const server = app({
      cancelRun: async () => {
        throw new Error('run registry down');
      },
    });
    const res = await request(server).post('/api/work/tasks/c-1/cancel');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('WORK_CANCEL_FAILED');
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
