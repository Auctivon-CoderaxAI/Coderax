import { SystemRoles } from 'coderax-data-provider';
import type { EngineHarness } from './__tests__/helpers/harness';
import type { RunningApp } from './__tests__/helpers/app';
import { createGatewayTestApp, listen, readSseFrames } from './__tests__/helpers/app';
import { startEngineHarness } from './__tests__/helpers/harness';

const OWNER = { id: 'owner-1', role: SystemRoles.ADMIN, email: 'owner@example.test' };
const MEMBER = { id: 'member-1', role: SystemRoles.USER, email: 'member@example.test' };

let harness: EngineHarness;
let running: RunningApp[] = [];

async function open(
  overrides: Record<string, unknown> = {},
  options: { user?: unknown; env?: NodeJS.ProcessEnv; token?: string } = {},
): Promise<RunningApp> {
  const app = createGatewayTestApp({
    user: 'user' in options ? options.user : OWNER,
    env: options.env ?? { WORKFLOW_ENGINE_TOKEN: harness.token },
    gateway: {
      enabled: true,
      baseUrl: harness.url,
      tokenEnv: 'WORKFLOW_ENGINE_TOKEN',
      authority: 'engine',
      ...overrides,
    },
  });
  const started = await listen(app);
  running.push(started);
  return started;
}

async function jsonRequest(
  target: RunningApp,
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: Record<string, unknown>; headers: Headers; text: string }> {
  const response = await fetch(`${target.url}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {},
    headers: response.headers,
    text,
  };
}

beforeEach(async () => {
  harness = await startEngineHarness();
  running = [];
});

afterEach(async () => {
  await Promise.all(running.map((app) => app.close()));
  await harness.close();
});

describe('gateway authentication', () => {
  it('refuses an unauthenticated caller before reaching the engine', async () => {
    const app = await open({}, { user: undefined });

    const response = await jsonRequest(app, '/v1/health');

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('unauthorized');
    expect(harness.requests).toHaveLength(0);
  });

  it('refuses a non-owner caller even though the server holds an engine credential', async () => {
    const app = await open({}, { user: MEMBER });

    const response = await jsonRequest(app, '/v1/work');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('forbidden');
    expect(harness.requests).toHaveLength(0);
  });
});

describe('gateway negotiation and diagnostics', () => {
  it('reports contract version and capabilities over HTTP', async () => {
    const app = await open();

    const meta = await jsonRequest(app, '/meta');

    expect(meta.status).toBe(200);
    const gateway = meta.body.gateway as Record<string, unknown>;
    const engine = meta.body.engine as Record<string, unknown>;
    expect(gateway.contractVersion).toBe('1.0.0');
    expect(gateway.authority).toBe('engine');
    expect(gateway.reversible).toBe(true);
    expect(engine.compatible).toBe(true);
    expect(engine.ready).toBe(true);
    const capabilities = meta.body.capabilities as Record<string, boolean>;
    expect(capabilities.work).toBe(true);
    expect(capabilities.scheduling).toBe(false);
    expect(meta.headers.get('x-coderax-contract-version')).toBe('1.0.0');
  });

  it('forwards the server-held credential and never leaks it to the client', async () => {
    const app = await open();

    const health = await jsonRequest(app, '/v1/health');

    expect(health.status).toBe(200);
    expect(health.body.contractVersion).toBe('1.0.0');
    expect(harness.requests.some((entry) => entry.path.startsWith('/v1/health'))).toBe(true);
    expect(
      harness.requests.every((entry) => entry.authorization === `Bearer ${harness.token}`),
    ).toBe(true);
    expect(health.text).not.toContain(harness.token);
    expect(JSON.stringify(Object.fromEntries(health.headers.entries()))).not.toContain(
      harness.token,
    );
  });

  it('refuses a client built against another contract version without calling the engine', async () => {
    const app = await open();

    const response = await jsonRequest(app, '/v1/agents', {
      headers: { 'x-coderax-contract-version': '2.0.0' },
    });

    expect(response.status).toBe(502);
    expect(response.body.code).toBe('contract_mismatch');
    expect(harness.requests).toHaveLength(0);
  });

  it('fails closed when a required capability is unavailable', async () => {
    const app = await open();

    const response = await jsonRequest(app, '/v1/agents', {
      headers: { 'x-coderax-required-capabilities': 'scheduling' },
    });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('capability_unavailable');
  });

  it('rejects an unknown required capability as a request error', async () => {
    const app = await open();

    const response = await jsonRequest(app, '/v1/agents', {
      headers: { 'x-coderax-required-capabilities': 'teleportation' },
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('validation_failed');
  });

  it('reports an incompatible engine contract instead of serving operations', async () => {
    const other = await startEngineHarness({ contractVersion: '2.0.0' });
    try {
      const app = await listen(
        createGatewayTestApp({
          user: OWNER,
          env: { WORKFLOW_ENGINE_TOKEN: other.token },
          gateway: {
            enabled: true,
            baseUrl: other.url,
            tokenEnv: 'WORKFLOW_ENGINE_TOKEN',
            authority: 'engine',
          },
        }),
      );
      running.push(app);

      const meta = await jsonRequest(app, '/meta');
      const agents = await jsonRequest(app, '/v1/agents');

      expect(meta.status).toBe(200);
      expect((meta.body.engine as Record<string, unknown>).compatible).toBe(false);
      expect(agents.status).toBe(502);
      expect(agents.body.code).toBe('contract_mismatch');
    } finally {
      await other.close();
    }
  });

  it('fails closed while the engine reports itself unready', async () => {
    await harness.close();
    harness = await startEngineHarness({ ready: false });
    const app = await open();

    const response = await jsonRequest(app, '/v1/agents');

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('not_ready');
  });
});

describe('gateway chat', () => {
  it('validates the request, forwards contract defaults and returns the validated reply', async () => {
    const app = await open();

    const response = await jsonRequest(app, '/v1/chat', {
      method: 'POST',
      body: { message: 'hello' },
    });

    expect(response.status).toBe(200);
    expect(response.body.text).toBe('reply text');
    expect(response.body.conversationId).toBe('conv_chat_1');
    const forwarded = harness.requests.find((entry) => entry.path === '/v1/chat');
    expect(forwarded?.body).toEqual({ message: 'hello', agent: 'coderax', mode: 'private' });
  });

  it('streams the validated final reply when the client accepts SSE', async () => {
    const app = await open();

    const response = await fetch(`${app.url}/v1/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ message: 'hello' }),
    });
    const frames = await readSseFrames(response);

    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ text: 'reply text', agent: 'coderax' });
  });

  it('refuses a conversation the in-repository engine owns', async () => {
    const app = await open({ authority: 'native' });

    const response = await jsonRequest(app, '/v1/chat', {
      method: 'POST',
      body: { message: 'hello', conversationId: 'conv_native' },
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('authority_conflict');
    expect(harness.counters.chat).toBe(0);
  });
});

describe('gateway work', () => {
  it('validates and forwards a work submission', async () => {
    const app = await open();

    const response = await jsonRequest(app, '/v1/work', {
      method: 'POST',
      body: { objective: 'do it' },
    });

    expect(response.status).toBe(202);
    expect(response.body.taskId).toBe('task_1');
    const forwarded = harness.requests.find((entry) => entry.path === '/v1/work');
    expect(forwarded?.body).toEqual({ objective: 'do it', mode: 'cloud', requireApproval: true });
  });

  it('rejects an unknown request field before forwarding it', async () => {
    const app = await open();

    const response = await jsonRequest(app, '/v1/work', {
      method: 'POST',
      body: { objective: 'do it', model: 'gpt-4', surprise: true },
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('validation_failed');
    expect(harness.counters.work).toBe(0);
  });

  it('streams the accepted task and its durable events', async () => {
    const app = await open();

    const response = await fetch(`${app.url}/v1/work`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ objective: 'do it' }),
    });
    const frames = (await readSseFrames(response)) as Array<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(frames[0]).toMatchObject({ type: 'accepted' });
    expect((frames[0]?.task as Record<string, unknown>).taskId).toBe('task_1');
    const events = frames.slice(1).map((frame) => frame.event as Record<string, unknown>);
    expect(events.map((event) => event.type)).toEqual([
      'task.queued',
      'task.started',
      'text.delta',
      'task.completed',
    ]);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
  });
});

describe('gateway event replay', () => {
  it('replays from the supplied cursor and tags frames for reconnection', async () => {
    const app = await open();
    await jsonRequest(app, '/v1/work', { method: 'POST', body: { objective: 'do it' } });

    const response = await fetch(`${app.url}/v1/work/task_1/events?after=2`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain('data:');
    expect(text).toContain('"seq":3');
    expect(text).toContain('"seq":4');
    expect(text).not.toContain('"seq":1');
    expect(text).toContain('id: 3');
  });

  it('fails closed on a conversation owned by the native engine', async () => {
    const app = await open({
      authority: 'native',
      engineConversations: ['conv_engine'],
    });
    const appWithTask = await open({
      authority: 'engine',
      nativeConversations: ['conv_native'],
    });

    const conflict = await jsonRequest(appWithTask, '/v1/work', {
      method: 'POST',
      body: { objective: 'do it', conversationId: 'conv_native' },
    });

    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('authority_conflict');
    expect(harness.counters.work).toBe(0);

    const created = await jsonRequest(appWithTask, '/v1/work', {
      method: 'POST',
      body: { objective: 'do it', conversationId: 'conv_engine_1' },
    });
    expect(created.status).toBe(202);

    const task = await jsonRequest(app, '/v1/work/task_1/events');
    expect(task.status).toBe(409);
    expect(task.body.code).toBe('authority_conflict');
  });

  it('closes the stream instead of forwarding a malformed event', async () => {
    await harness.close();
    harness = await startEngineHarness({ corruptEventStream: true });
    const app = await open();
    await jsonRequest(app, '/v1/work', { method: 'POST', body: { objective: 'do it' } });

    const response = await fetch(`${app.url}/v1/work/task_1/events`);
    const frames = await readSseFrames(response);

    expect(frames).toHaveLength(2);
    expect(frames.every((frame) => typeof (frame as { seq?: unknown }).seq === 'number')).toBe(
      true,
    );
  });
});

describe('gateway task discovery and artifacts', () => {
  it('returns authoritative status and a read-only artifact projection', async () => {
    const app = await open();
    await jsonRequest(app, '/v1/work', { method: 'POST', body: { objective: 'do it' } });

    const task = await jsonRequest(app, '/v1/work/task_1');
    const artifacts = await jsonRequest(app, '/v1/work/task_1/artifacts');

    expect(task.status).toBe(200);
    expect(task.body.state).toBe('running');
    expect(artifacts.status).toBe(200);
    expect(artifacts.body).toEqual({
      taskId: 'task_1',
      conversationId: 'conv_work_1',
      state: 'running',
      artifacts: [],
    });
  });

  it('returns not_found from the engine as a contract problem', async () => {
    const app = await open();

    const response = await jsonRequest(app, '/v1/work/task_missing');

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('not_found');
  });
});

describe('gateway control operations', () => {
  it('cancels a task when the engine advertises cancellation', async () => {
    const app = await open();
    await jsonRequest(app, '/v1/work', { method: 'POST', body: { objective: 'do it' } });

    const response = await jsonRequest(app, '/v1/work/task_1/cancel', {
      method: 'POST',
      body: { reason: 'owner asked' },
    });

    expect(response.status).toBe(200);
    expect(response.body.outcome).toBe('accepted');
    expect(harness.counters.cancel).toBe(1);
    expect(harness.decidedPermissions).toHaveLength(0);
  });

  it('fails closed for cancellation the engine does not support', async () => {
    await harness.close();
    harness = await startEngineHarness({ capabilities: { cancellation: false } });
    const app = await open();
    await jsonRequest(app, '/v1/work', { method: 'POST', body: { objective: 'do it' } });

    const response = await jsonRequest(app, '/v1/work/task_1/cancel', {
      method: 'POST',
      body: {},
    });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('capability_unavailable');
    expect(harness.counters.cancel).toBe(0);
  });

  it('retries and resumes through the engine after capability negotiation', async () => {
    const app = await open();
    await jsonRequest(app, '/v1/work', { method: 'POST', body: { objective: 'do it' } });

    const retry = await jsonRequest(app, '/v1/work/task_1/retry', {
      method: 'POST',
      body: { generation: 1 },
    });
    const resume = await jsonRequest(app, '/v1/work/task_1/resume', {
      method: 'POST',
      body: { generation: 2 },
    });

    expect(retry.status).toBe(200);
    expect(resume.status).toBe(200);
    expect(harness.counters.retry).toBe(1);
    expect(harness.counters.resume).toBe(1);
  });

  it('rejects a control request without its required generation', async () => {
    const app = await open();
    await jsonRequest(app, '/v1/work', { method: 'POST', body: { objective: 'do it' } });

    const response = await jsonRequest(app, '/v1/work/task_1/resume', {
      method: 'POST',
      body: {},
    });

    expect(response.status).toBe(400);
    expect(harness.counters.resume).toBe(0);
  });
});

describe('gateway permissions', () => {
  it('lists and records a permission decision', async () => {
    const app = await open();
    await jsonRequest(app, '/v1/work', { method: 'POST', body: { objective: 'do it' } });

    const list = await jsonRequest(app, '/v1/work/task_1/permissions');
    const decided = await jsonRequest(app, '/v1/work/task_1/permissions', {
      method: 'POST',
      body: { requestId: 'req_1', decision: 'approved' },
    });

    expect(list.status).toBe(200);
    expect(list.body.requests).toEqual([]);
    expect(decided.status).toBe(200);
    expect(harness.decidedPermissions).toEqual([{ requestId: 'req_1', decision: 'approved' }]);
  });

  it('rejects a decision the engine did not record', async () => {
    const app = await open();
    await jsonRequest(app, '/v1/work', { method: 'POST', body: { objective: 'do it' } });
    harness.overrideOnce({
      path: '/v1/work/task_1/permissions',
      status: 200,
      body: { requests: [] },
    });

    const response = await jsonRequest(app, '/v1/work/task_1/permissions', {
      method: 'POST',
      body: { requestId: 'req_1', decision: 'denied' },
    });

    expect(response.status).toBe(502);
    expect(response.body.code).toBe('contract_mismatch');
  });
});

describe('gateway discovery surfaces', () => {
  it('filters conversation and notification lists to engine-owned conversations', async () => {
    const app = await open({ authority: 'native', engineConversations: ['conv_work_1'] });

    const conversations = await jsonRequest(app, '/v1/conversations');
    const notifications = await jsonRequest(app, '/v1/notifications');

    expect(conversations.status).toBe(200);
    expect(conversations.body.conversations).toEqual([
      {
        conversationId: 'conv_work_1',
        title: 'Engine work',
        isWork: true,
        agent: 'coderax',
        updatedAt: '2026-11-26T12:00:00.000Z',
      },
    ]);
    expect(notifications.status).toBe(200);
    expect((notifications.body.notifications as unknown[]).length).toBe(1);
    expect(notifications.body.unread).toBe(1);
  });

  it('reads owner-scoped memory only while the engine owns the data plane', async () => {
    const engine = await open({ authority: 'engine' });
    const native = await open({ authority: 'native' });

    const memory = await jsonRequest(engine, '/v1/memory?mode=cloud');
    const refused = await jsonRequest(native, '/v1/memory');

    expect(memory.status).toBe(200);
    expect((memory.body.entries as Array<Record<string, unknown>>)[0]).toMatchObject({
      mode: 'cloud',
    });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('transport_native');
  });
});

describe('gateway fail-closed configuration and upstream failures', () => {
  it('refuses scheduling because the engine contract publishes no such operation', async () => {
    const app = await open();

    const response = await jsonRequest(app, '/v1/schedules');

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('capability_unavailable');
    expect(harness.requests).toHaveLength(0);
  });

  it('refuses every operation when the gateway is disabled', async () => {
    const app = await open({ enabled: false });

    const response = await jsonRequest(app, '/v1/agents');

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('gateway_disabled');
    expect(harness.requests).toHaveLength(0);
  });

  it('refuses every operation when the engine credential is absent', async () => {
    const app = await open({}, { env: {} });

    const response = await jsonRequest(app, '/v1/agents');

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('engine_not_configured');
    expect(harness.requests).toHaveLength(0);
  });

  it('propagates a stable engine failure code without forwarding upstream text', async () => {
    const app = await open();
    await jsonRequest(app, '/v1/work', { method: 'POST', body: { objective: 'do it' } });
    harness.overrideOnce({
      path: '/v1/work/task_1/cancel',
      status: 409,
      body: {
        type: 'https://coderax.dev/problems/permission_required',
        title: 'permission required',
        status: 409,
        code: 'permission_required',
        detail: 'secret internal detail about the upstream workspace',
        retryable: false,
      },
    });

    const response = await jsonRequest(app, '/v1/work/task_1/cancel', {
      method: 'POST',
      body: {},
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('permission_required');
    expect(response.body.detail).toBeUndefined();
    expect(response.text).not.toContain('secret internal detail');
  });

  it('maps an engine authentication failure to unauthorized', async () => {
    const app = await open({}, { env: { WORKFLOW_ENGINE_TOKEN: 'wrong-token' } });

    // Health and readiness are public engine operations, so the owner operation
    // is what proves the credential is forwarded and its rejection propagates.
    const response = await jsonRequest(app, '/v1/agents');

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('unauthorized');
  });

  it('refuses a success body that does not match the contract', async () => {
    const app = await open();
    harness.overrideOnce({
      path: '/v1/conversations',
      status: 200,
      body: { conversations: [{ conversationId: 42 }] },
    });

    const response = await jsonRequest(app, '/v1/conversations');

    expect(response.status).toBe(502);
    expect(response.body.code).toBe('contract_mismatch');
  });

  it('refuses an engine that answers a streaming operation with JSON', async () => {
    const app = await open();
    await jsonRequest(app, '/v1/work', { method: 'POST', body: { objective: 'do it' } });
    harness.overrideOnce({
      path: '/v1/work/task_1/events',
      status: 200,
      body: { events: [] },
    });

    const response = await fetch(`${app.url}/v1/work/task_1/events`);

    expect(response.status).toBe(502);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      code: 'contract_mismatch',
    });
  });
});
