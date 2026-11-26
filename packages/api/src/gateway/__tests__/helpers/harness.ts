import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

/**
 * A minimal, real WorkflowEngine harness for gateway integration tests.
 *
 * It implements contract 1.0.0 over TCP: bearer-authenticated owner routes,
 * `Problem` failures, SSE event replay with a sequence cursor, and terminal
 * stream closure. It is a test double, not a second implementation of the
 * engine: it exists so the gateway is exercised over actual HTTP instead of a
 * mocked client.
 */

export type HarnessCapabilities = {
  streaming: boolean;
  tools: boolean;
  cancellation: boolean;
  resume: boolean;
  modelSelection: boolean;
  durable: boolean;
};

export type HarnessOptions = {
  token?: string;
  contractVersion?: string;
  ready?: boolean;
  capabilities?: Partial<HarnessCapabilities>;
  /** Emit one malformed frame in the middle of an event stream. */
  corruptEventStream?: boolean;
};

export type HarnessRequest = {
  method: string;
  path: string;
  authorization?: string;
  body?: unknown;
};

export type Override = {
  /** Path prefix to match, e.g. `/v1/work/task_1/permissions`. */
  path: string;
  status: number;
  body: unknown;
};

const FIXED_TIME = '2026-11-26T12:00:00.000Z';

const problem = (status: number, code: string, detail?: string) => ({
  type: `https://coderax.dev/problems/${code}`,
  title: code.replace(/_/g, ' '),
  status,
  code,
  retryable: false,
  ...(detail ? { detail } : {}),
});

const taskRecord = (taskId: string, conversationId: string) => ({
  taskId,
  conversationId,
  state: 'running',
  agent: 'coderax',
  mode: 'cloud',
  generation: 1,
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
  cancelRequested: false,
  steps: [],
});

export type EngineHarness = Awaited<ReturnType<typeof startEngineHarness>>;

export async function startEngineHarness(options: HarnessOptions = {}) {
  const token = options.token ?? 'engine-owner-token-for-tests';
  const capabilities: HarnessCapabilities = {
    streaming: true,
    tools: true,
    cancellation: true,
    resume: true,
    modelSelection: true,
    durable: true,
    ...options.capabilities,
  };

  const requests: HarnessRequest[] = [];
  const overrides: Override[] = [];
  const tasks = new Map<string, ReturnType<typeof taskRecord>>();
  const counters = { cancel: 0, resume: 0, retry: 0, chat: 0, work: 0 };
  const decidedPermissions: unknown[] = [];

  const eventsFor = (taskId: string) => {
    const envelope = (seq: number) => ({
      v: 1,
      eventId: `evt_${taskId}_${seq}`,
      taskId,
      seq,
      at: FIXED_TIME,
      agent: 'coderax',
      generation: 1,
    });
    return [
      { ...envelope(1), type: 'task.queued' },
      { ...envelope(2), type: 'task.started', payload: {} },
      { ...envelope(3), type: 'text.delta', payload: { text: 'hello' } },
      {
        ...envelope(4),
        type: 'task.completed',
        payload: { summary: 'done' },
      },
    ];
  };

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://harness.local');
    const path = url.pathname;

    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown;
      try {
        body = raw.trim().length === 0 ? undefined : JSON.parse(raw);
      } catch {
        body = raw;
      }
      requests.push({
        method: req.method ?? 'GET',
        path: `${path}${url.search}`,
        ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
        ...(body === undefined ? {} : { body }),
      });

      const override = overrides.find((entry) => path.startsWith(entry.path));
      if (override != null) {
        res.writeHead(override.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(override.body));
        return;
      }

      const publicRoute = path === '/v1/health' || path === '/v1/ready';
      if (!publicRoute && req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify(problem(401, 'unauthorized')));
        return;
      }

      const json = (status: number, payload: unknown) => {
        res.writeHead(status, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        });
        res.end(JSON.stringify(payload));
      };

      if (req.method === 'GET' && path === '/v1/health') {
        json(200, {
          status: 'ok',
          contractVersion: options.contractVersion ?? '1.0.0',
          startedAt: FIXED_TIME,
          uptimeMs: 1_000,
          checks: [{ name: 'mongo', status: 'ok', required: true }],
          engines: [
            {
              id: 'native',
              capabilities,
              availability: { available: true, reason: 'ready', detail: 'ready' },
            },
          ],
        });
        return;
      }

      if (req.method === 'GET' && path === '/v1/ready') {
        json(200, {
          ready: options.ready ?? true,
          missing: options.ready === false ? ['mongo'] : [],
          checks: [],
        });
        return;
      }

      if (req.method === 'GET' && path === '/v1/agents') {
        json(200, {
          agents: [
            {
              id: 'coderax',
              engine: 'native',
              label: 'Coderax',
              external: false,
              capabilities,
              availability: { available: true, reason: 'ready', detail: 'ready' },
              isolation: {
                workspace: 'isolated',
                memory: 'granted',
                credentials: 'scoped',
                conversations: 'granted',
              },
            },
          ],
        });
        return;
      }

      if (req.method === 'GET' && path === '/v1/models') {
        json(200, {
          models: [
            {
              ref: { providerId: 'free', modelId: 'free-model' },
              label: 'Free model',
              costClass: 'free',
              toolCalling: true,
              streaming: true,
              availability: { available: true, reason: 'ready', detail: 'ready' },
            },
          ],
          route: [{ providerId: 'free', modelId: 'free-model' }],
          allowPaid: false,
        });
        return;
      }

      if (req.method === 'POST' && path === '/v1/chat') {
        counters.chat += 1;
        const input = body as { message?: string; conversationId?: string };
        json(200, {
          conversationId: input?.conversationId ?? 'conv_chat_1',
          messageId: 'msg_1',
          text: 'reply text',
          agent: 'coderax',
          model: { providerId: 'free', modelId: 'free-model' },
          createdAt: FIXED_TIME,
        });
        return;
      }

      if (req.method === 'POST' && path === '/v1/work') {
        counters.work += 1;
        const input = body as { conversationId?: string };
        const taskId = `task_${counters.work}`;
        const conversationId = input?.conversationId ?? 'conv_work_1';
        tasks.set(taskId, taskRecord(taskId, conversationId));
        json(202, {
          taskId,
          conversationId,
          state: 'queued',
          generation: 1,
          eventsPath: `/v1/work/${taskId}/events`,
        });
        return;
      }

      const taskMatch = /^\/v1\/work\/([^/]+)(\/[a-z]+)?$/.exec(path);
      if (taskMatch != null) {
        const taskId = decodeURIComponent(taskMatch[1] as string);
        const suffix = taskMatch[2];
        const task = tasks.get(taskId);

        if (req.method === 'GET' && suffix == null) {
          if (task == null) {
            json(404, problem(404, 'not_found'));
            return;
          }
          json(200, { ...task, updatedAt: FIXED_TIME });
          return;
        }

        if (req.method === 'GET' && suffix === '/events') {
          if (task == null) {
            json(404, problem(404, 'not_found'));
            return;
          }
          const after = Number.parseInt(url.searchParams.get('after') ?? '0', 10) || 0;
          const stream = eventsFor(taskId).filter((event) => event.seq > after);
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-store',
            connection: 'keep-alive',
          });
          let sent = 0;
          for (const event of stream) {
            if (sent === 2 && options.corruptEventStream) {
              res.write('data: {"not":"an event"}\n\n');
            }
            res.write(`data: ${JSON.stringify(event)}\n\n`);
            sent += 1;
          }
          res.end();
          return;
        }

        if (req.method === 'POST' && suffix === '/cancel') {
          counters.cancel += 1;
          json(200, {
            taskId,
            state: 'cancelled',
            generation: 1,
            outcome: 'accepted',
          });
          return;
        }

        if (req.method === 'POST' && suffix === '/resume') {
          counters.resume += 1;
          json(200, {
            taskId,
            state: 'running',
            generation: 2,
            outcome: 'accepted',
          });
          return;
        }

        if (req.method === 'POST' && suffix === '/retry') {
          counters.retry += 1;
          json(200, {
            taskId,
            state: 'queued',
            generation: 2,
            outcome: 'accepted',
          });
          return;
        }

        if (suffix === '/permissions') {
          if (req.method === 'GET') {
            json(200, { requests: [] });
            return;
          }
          if (req.method === 'POST') {
            const decision = body as { requestId: string; decision: 'approved' | 'denied' };
            decidedPermissions.push(decision);
            json(200, {
              requests: [
                {
                  requestId: decision.requestId,
                  taskId,
                  agent: 'coderax',
                  scope: 'workspace.write',
                  description: 'Write a file',
                  resource: '/workspace/file.txt',
                  requestedAt: FIXED_TIME,
                  expiresAt: FIXED_TIME,
                  decision: decision.decision,
                  decidedAt: FIXED_TIME,
                },
              ],
            });
            return;
          }
        }
      }

      if (req.method === 'GET' && path === '/v1/conversations') {
        json(200, {
          conversations: [
            {
              conversationId: 'conv_work_1',
              title: 'Engine work',
              isWork: true,
              agent: 'coderax',
              updatedAt: FIXED_TIME,
            },
            {
              conversationId: 'conv_other',
              title: 'Other',
              isWork: false,
              agent: 'coderax',
              updatedAt: FIXED_TIME,
            },
          ],
        });
        return;
      }

      const conversationMatch = /^\/v1\/conversations\/([^/]+)$/.exec(path);
      if (req.method === 'GET' && conversationMatch != null) {
        const conversationId = decodeURIComponent(conversationMatch[1] as string);
        json(200, {
          conversationId,
          title: 'Engine conversation',
          mode: 'private',
          isWork: false,
          agent: 'coderax',
          createdAt: FIXED_TIME,
          updatedAt: FIXED_TIME,
          messages: [],
        });
        return;
      }

      if (req.method === 'GET' && path === '/v1/memory') {
        json(200, {
          entries: [
            {
              key: 'preference',
              value: 'concise',
              mode: url.searchParams.get('mode') === 'cloud' ? 'cloud' : 'private',
              updatedAt: FIXED_TIME,
            },
          ],
        });
        return;
      }

      if (req.method === 'GET' && path === '/v1/notifications') {
        json(200, {
          notifications: [
            {
              taskId: 'task_1',
              conversationId: 'conv_work_1',
              agent: 'coderax',
              mode: 'cloud',
              state: 'completed',
              createdAt: FIXED_TIME,
              read: false,
            },
            {
              taskId: 'task_9',
              conversationId: 'conv_other',
              agent: 'coderax',
              mode: 'cloud',
              state: 'completed',
              createdAt: FIXED_TIME,
              read: true,
            },
          ],
          unread: 1,
        });
        return;
      }

      json(404, problem(404, 'not_found'));
    })().catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify(problem(500, 'internal_error')));
      } else {
        res.end();
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address != null ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    token,
    requests,
    tasks,
    counters,
    decidedPermissions,
    overrideOnce: (entry: Override) => {
      overrides.push(entry);
    },
    clearOverrides: () => {
      overrides.length = 0;
    },
    newConversationId: () => `conv_${randomUUID()}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
