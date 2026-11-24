import express from 'express';
import request from 'supertest';
import type { Application } from 'express';
import type { WorkConversation } from './task';
import type { WorkDeps } from './router';
import { createWorkRouter } from './router';

type Stored = WorkConversation & { userId: string };

function app(
  deps: Partial<WorkDeps> & {
    user?: { id: string } | null;
    role?: string;
    workChatEnabled?: boolean;
  } = {},
): Application {
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
    const user = deps.user ?? { id: 'user-a' };
    (req as never as { user: { id: string; role?: string } }).user = deps.role
      ? { ...user, role: deps.role }
      : user;
    if (deps.workChatEnabled === true) {
      (req as never as { config: unknown }).config = {
        config: { engines: { workChat: { enabled: true } } },
      };
    }
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

  it('reports hosted routing as disabled until the deployment opts in', async () => {
    const res = await request(app()).get('/api/work/routing');
    expect(res.status).toBe(200);
    expect(res.body.routing).toMatchObject({
      enabled: false,
      activeModel: null,
      endpoints: [],
      paidRoutesEnabled: false,
    });
    expect(res.body.routing.primary.available).toBe(false);
  });

  it('names the provider and model a turn would use, and the fallback reason', async () => {
    const res = await request(
      app({
        routing: async () => ({
          enabled: true,
          primary: {
            available: false,
            label: 'DeepSeek-R1 671B',
            modelIds: ['deepseek/deepseek-r1-0528'],
            reason: 'no_verified_free_endpoint',
            checkedAt: '2026-11-08',
            evidence: [],
          },
          activeModel: {
            provider: 'groq',
            modelId: 'openai/gpt-oss-120b',
            label: 'OpenAI GPT-OSS 120B on Groq',
          },
          endpoints: [],
          paidRoutesEnabled: false,
        }),
      }),
    ).get('/api/work/routing');

    expect(res.status).toBe(200);
    expect(res.body.routing.activeModel).toEqual({
      provider: 'groq',
      modelId: 'openai/gpt-oss-120b',
      label: 'OpenAI GPT-OSS 120B on Groq',
    });
    expect(res.body.routing.primary.reason).toBe('no_verified_free_endpoint');
  });

  it('reports an unusable router without leaking its error text', async () => {
    const res = await request(
      app({
        routing: async () => {
          throw new Error('provider payload with ghp_secret_token');
        },
      }),
    ).get('/api/work/routing');

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('WORK_ROUTING_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain('ghp_secret_token');
  });

  it('serves native models with the automatic choice first', async () => {
    const res = await request(app()).get('/api/work/models');
    expect(res.status).toBe(200);
    expect(res.body.models.map((model: { id: string }) => model.id)).toEqual([
      'auto',
      'llama3:latest',
    ]);
  });

  it('lists exactly three identities with native first and default', async () => {
    const res = await request(
      app({
        role: 'ADMIN',
        workChatEnabled: true,
        workChat: { enabled: true, mode: 'cloud' },
        engines: async () => ({
          defaultEngine: 'freebuff',
          engines: ['opencode', 'freebuff'].map((id) => ({
            id: id as 'opencode' | 'freebuff',
            capabilities: {
              streaming: true,
              tools: true,
              cancellation: true,
              modelSelection: false,
            },
            availability: { available: true, reason: 'ready' },
          })),
        }),
      }),
    ).get('/api/work/agent-identities');

    expect(res.status).toBe(200);
    expect(res.body.defaultAgent).toBe('coderax');
    expect(res.body.agents.map((agent: { id: string }) => agent.id)).toEqual([
      'coderax',
      'opencode',
      'freebuff',
    ]);
    expect(res.body.agents[0]).toMatchObject({
      label: 'Coderax Personal Agent',
      kind: 'native',
      availability: { available: true },
    });
    expect(res.body.agents[1].availability).toMatchObject({ available: true });
    expect(res.body.agents[2].availability).toMatchObject({ available: true });
  });

  it('does not offer external identities to a non-admin or probe their engines', async () => {
    const engines = jest.fn();
    const res = await request(
      app({
        role: 'USER',
        workChat: { enabled: true, mode: 'cloud' },
        engines,
      }),
    ).get('/api/work/agent-identities');

    expect(res.status).toBe(200);
    expect(res.body.agents.map((agent: { availability: unknown }) => agent.availability)).toEqual([
      { available: true },
      expect.objectContaining({ available: false, reason: 'owner_only' }),
      expect.objectContaining({ available: false, reason: 'owner_only' }),
    ]);
    expect(engines).not.toHaveBeenCalled();
  });

  it('keeps native available while external identities report why they cannot run', async () => {
    const res = await request(app({ role: 'ADMIN', workChatEnabled: true })).get(
      '/api/work/agent-identities',
    );

    expect(res.status).toBe(200);
    expect(res.body.agents[0].availability).toMatchObject({ available: true });
    expect(res.body.agents[1].availability).toMatchObject({
      available: false,
      reason: 'disabled',
    });
    expect(res.body.agents[2].availability).toMatchObject({
      available: false,
      reason: 'disabled',
    });
  });

  it('surfaces a stable Freebuff readiness reason', async () => {
    const res = await request(
      app({
        engines: async () => ({
          defaultEngine: 'freebuff',
          engines: [
            {
              id: 'freebuff',
              capabilities: {
                streaming: true,
                tools: true,
                cancellation: true,
                modelSelection: false,
              },
              availability: {
                available: false,
                reason: 'context_too_small',
                detail: 'The configured local model declares an 8192-token context.',
              },
            },
          ],
        }),
      }),
    ).get('/api/work/engines');

    expect(res.status).toBe(200);
    expect(res.body.engines[0].availability).toEqual({
      available: false,
      reason: 'context_too_small',
      detail: 'The configured local model declares an 8192-token context.',
    });
  });

  it('names the routing intents and their concrete target on the model response', async () => {
    const res = await request(app()).get('/api/work/models');
    expect(res.status).toBe(200);
    expect(res.body.routingModes.map((mode: { id: string }) => mode.id)).toEqual([
      'auto',
      'fast',
      'complex',
    ]);
    expect(res.body.routingModes[0]).toMatchObject({
      id: 'auto',
      auto: true,
      routingMode: 'auto',
      target: { id: 'llama3:latest' },
    });
  });

  it('does not offer an unverified paid configured default', async () => {
    const res = await request(app({ configuredDefaultModel: async () => 'openai:gpt-4o' })).get(
      '/api/work/models',
    );
    expect(res.status).toBe(200);
    expect(res.body.models.map((model: { id: string }) => model.id)).toEqual([
      'auto',
      'llama3:latest',
    ]);
    expect(res.body.models[0].target).toMatchObject({
      id: 'llama3:latest',
    });
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

  it('lists eligible agents across graph-check batches', async () => {
    const agents = Array.from({ length: 9 }, (_, index) => ({
      id: `agent-${index}`,
      model: 'llama3:latest',
      provider: 'ollama',
    }));
    const res = await request(
      app({
        listModels: async () => [{ id: 'llama3:latest', provider: 'ollama', local: true }],
        listAgents: async () => agents,
      }),
    ).get('/api/work/agents');
    expect(res.status).toBe(200);
    expect(res.body.agents.map((agent: { id: string }) => agent.id)).toEqual(
      agents.map((agent) => agent.id),
    );
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

  it('serves history when stored timestamps are Date objects', async () => {
    const server = app({
      listConversations: async () => [
        {
          conversationId: 'c-1',
          title: 'Plan',
          isWork: true,
          createdAt: new Date('2026-11-22T16:00:00.000Z'),
          updatedAt: new Date('2026-11-22T16:01:00.000Z'),
        },
      ],
    });
    const res = await request(server).get('/api/work/tasks');
    expect(res.status).toBe(200);
    expect(res.body.tasks[0]).toMatchObject({
      id: 'c-1',
      createdAt: '2026-11-22T16:00:00.000Z',
      updatedAt: '2026-11-22T16:01:00.000Z',
    });
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

  it('names the model the automatic option resolves to', async () => {
    const res = await request(app()).get('/api/work/models');
    expect(res.body.models[0]).toEqual({
      id: 'auto',
      label: 'Automatic',
      auto: true,
      target: { id: 'llama3:latest', label: 'llama3:latest' },
    });
  });

  it('keeps automatic routing when the configured default cannot be read', async () => {
    const res = await request(
      app({
        configuredDefaultModel: async () => {
          throw new Error('config down');
        },
      }),
    ).get('/api/work/models');
    expect(res.status).toBe(200);
    expect(res.body.models[0].target.id).toBe('llama3:latest');
  });

  describe('agents', () => {
    const catalog = async () => [
      { id: 'llama3:latest', provider: 'ollama', local: true },
      { id: 'qwen:7b', provider: 'ollama', local: true },
      { id: 'gpt-4o', provider: 'openAI' },
    ];

    it('does not offer an agent on the unverified paid configured default', async () => {
      const res = await request(
        app({
          listModels: catalog,
          configuredDefaultModel: async () => ({ id: 'gpt-4o', provider: 'openAI' }),
          listAgents: async () => [
            { id: 'paid', name: 'Paid', model: 'gpt-4o', provider: 'openAI' },
          ],
        }),
      ).get('/api/work/agents');
      expect(res.status).toBe(200);
      expect(res.body.agents).toEqual([]);
    });

    it('offers only agents whose whole graph runs on free or local models', async () => {
      const res = await request(
        app({
          listModels: catalog,
          listAgents: async () => [
            {
              id: 'lead',
              name: 'Lead',
              model: 'llama3:latest',
              provider: 'ollama',
              edges: [{ from: 'lead', to: 'writer', edgeType: 'handoff' }],
            },
            { id: 'writer', name: 'Writer', model: 'qwen:7b', provider: 'ollama' },
            { id: 'paid', name: 'Paid', model: 'gpt-4o', provider: 'openAI' },
            {
              id: 'mixed',
              name: 'Mixed',
              model: 'llama3:latest',
              provider: 'ollama',
              subagents: { enabled: true, agent_ids: ['paid'] },
            },
          ],
        }),
      ).get('/api/work/agents');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.agents).toEqual([
        {
          id: 'lead',
          name: 'Lead',
          model: 'llama3:latest',
          provider: 'ollama',
          members: [{ id: 'writer', name: 'Writer', model: 'qwen:7b', provider: 'ollama' }],
        },
        { id: 'writer', name: 'Writer', model: 'qwen:7b', provider: 'ollama', members: [] },
      ]);
    });

    it('offers none when the deployment wires no agent source', async () => {
      const res = await request(app({ listModels: catalog })).get('/api/work/agents');
      expect(res.status).toBe(200);
      expect(res.body.agents).toEqual([]);
    });

    it('reports an agent store failure as unavailable, not as no agents', async () => {
      const res = await request(
        app({
          listModels: catalog,
          listAgents: async () => {
            throw new Error('agents down');
          },
        }),
      ).get('/api/work/agents');
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('WORK_AGENTS_UNAVAILABLE');
    });

    it('requires an authenticated user', async () => {
      const res = await request(app({ user: null, listAgents: async () => [] })).get(
        '/api/work/agents',
      );
      expect(res.status).toBe(401);
    });
  });
});
