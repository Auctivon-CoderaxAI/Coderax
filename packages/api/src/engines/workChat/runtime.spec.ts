import os from 'node:os';
import path from 'node:path';
import { mkdtemp, realpath, rm, symlink, rmdir } from 'node:fs/promises';
import type { EngineRegistryApi } from '../registry';
import type { EngineRunHandle } from '../types';
import {
  DEFAULT_WORK_RUN_RETENTION_MS,
  WORK_RUN_SWEEP_LIMIT,
  createMemoryWorkRunLeaseStore,
} from './leases';
import { EngineWorkChatRuntime } from './runtime';

let cloudRoot = '';
const roots = {
  private: '/srv/coderax/private',
  get cloud() {
    return cloudRoot;
  },
};
/** Small enough that a heartbeat tick lands inside a test. */
const LEASE_TTL_MS = 60;

beforeAll(async () => {
  cloudRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'coderax-runtime-')));
});

afterAll(async () => {
  await rm(cloudRoot, { recursive: true, force: true });
});

function handle(sessionId: string): EngineRunHandle {
  return {
    sessionId,
    events: (async function* () {})(),
    cancel: jest.fn(async () => undefined),
    result: Promise.resolve({ ok: true as const, value: { sessionId, toolCalls: 0, edits: 0 } }),
    close: jest.fn(async () => undefined),
  };
}

function fakeRegistry(start: jest.Mock) {
  return {
    start,
    select: jest.fn(),
    probe: jest.fn(async () => undefined),
    snapshot: () => ({ defaultEngine: 'opencode' as const, engines: [] }),
    arbiter: {},
  } as unknown as EngineRegistryApi;
}

const scope = (
  conversationId: string,
  overrides: { userId?: string; tenantId?: string | null } = {},
) => ({
  userId: overrides.userId ?? 'owner',
  tenantId: overrides.tenantId === undefined ? 'tenant-1' : overrides.tenantId,
  conversationId,
  engine: 'opencode' as const,
});

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('The expected run state never arrived.');
}

async function waitForState(
  runtime: EngineWorkChatRuntime,
  runScope: Parameters<EngineWorkChatRuntime['state']>[0],
  expected: string | null,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await runtime.state(runScope)) === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`The run state never became ${expected}.`);
}

describe('EngineWorkChatRuntime', () => {
  it('maps a private run onto the canonical engine request', async () => {
    const run = handle('session-private');
    const start = jest.fn(async () => ({ ok: true as const, value: run }));
    const runtime = new EngineWorkChatRuntime(fakeRegistry(start), roots);

    await expect(runtime.start({ ...scope('conversation-a'), prompt: 'Fix it' })).resolves.toEqual({
      ok: true,
      value: run,
    });
    expect(start).toHaveBeenCalledWith({
      engine: 'opencode',
      request: {
        taskKey: 'conversation-a',
        conversationId: 'conversation-a',
        prompt: 'Fix it',
        mode: 'private',
        workspaceRoot: '/srv/coderax/private',
      },
    });
    await expect(runtime.state(scope('conversation-a'))).resolves.toBe('running');

    await runtime.release(scope('conversation-a'));
  });

  it('sends cloud runs to the cloud root with the configured model', async () => {
    const start = jest.fn(async () => ({ ok: true as const, value: handle('session-cloud') }));
    const runtime = new EngineWorkChatRuntime(fakeRegistry(start), roots, 'cloud', {
      providerId: 'ollama',
      modelId: 'qwen3.5:4b',
    });

    await runtime.start({ ...scope('conversation-b'), prompt: 'Fix it' });
    expect(start).toHaveBeenCalledWith({
      engine: 'opencode',
      request: {
        taskKey: JSON.stringify(['tenant-1', 'owner', 'conversation-b']),
        conversationId: 'conversation-b',
        prompt: 'Fix it',
        mode: 'cloud',
        workspaceRoot: expect.stringMatching(/work-opencode-[a-f0-9]{64}$/),
        model: { providerId: 'ollama', modelId: 'qwen3.5:4b' },
      },
    });

    await runtime.release(scope('conversation-b'));
  });

  it('refuses a second live run for the same tenant, user and conversation', async () => {
    const start = jest.fn(async () => ({ ok: true as const, value: handle('session-busy') }));
    const runtime = new EngineWorkChatRuntime(fakeRegistry(start), roots);
    const conversation = 'conversation-c';

    await runtime.start({ ...scope(conversation), prompt: 'First' });
    const second = await runtime.start({ ...scope(conversation), prompt: 'Second' });

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('busy');
    expect(start).toHaveBeenCalledTimes(1);

    await runtime.release(scope(conversation));
    await expect(runtime.start({ ...scope(conversation), prompt: 'Third' })).resolves.toMatchObject(
      {
        ok: true,
      },
    );
    await runtime.release(scope(conversation));
  });

  it('isolates cloud workspaces by tenant, user, conversation and engine', async () => {
    const start = jest.fn<
      ReturnType<EngineRegistryApi['start']>,
      Parameters<EngineRegistryApi['start']>
    >(async () => ({ ok: true, value: handle('session-key') }));
    const runtime = new EngineWorkChatRuntime(fakeRegistry(start), roots, 'cloud');
    const scopes = [
      scope('conversation-d'),
      scope('conversation-d', { tenantId: 'tenant-2' }),
      scope('conversation-d', { userId: 'other' }),
      scope('conversation-e'),
      { ...scope('conversation-d'), engine: 'freebuff' as const },
    ];

    for (const runScope of scopes) {
      await expect(runtime.start({ ...runScope, prompt: 'Run' })).resolves.toMatchObject({
        ok: true,
      });
      runtime.release(runScope);
    }
    const workspaces = start.mock.calls.map(([input]) => input.request.workspaceRoot);
    expect(new Set(workspaces).size).toBe(scopes.length);
    expect(workspaces.map((workspace) => path.dirname(workspace))).toEqual(
      scopes.map(() => cloudRoot),
    );

    await runtime.release(scope('conversation-d'));
    await runtime.release(scope('conversation-d', { tenantId: 'tenant-2' }));
    await runtime.release(scope('conversation-d', { userId: 'other' }));
    await runtime.release(scope('conversation-e'));

    await runtime.start({ ...scopes[0], prompt: 'Continue' });
    expect(start.mock.lastCall?.[0].request.workspaceRoot).toBe(workspaces[0]);
    await runtime.release(scopes[0]);

    await rmdir(workspaces[0]);
    await symlink(workspaces[1], workspaces[0], 'dir');
    start.mockClear();
    await expect(runtime.start({ ...scopes[0], prompt: 'Continue' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'workspace_denied' },
    });
    expect(start).not.toHaveBeenCalled();
  });

  it('does not hold a lease when the registry refuses to start', async () => {
    const start = jest.fn(async () => ({
      ok: false as const,
      error: { code: 'disabled' as const, message: 'The engine is disabled.' },
    }));
    const runtime = new EngineWorkChatRuntime(fakeRegistry(start), roots);
    const conversation = 'conversation-f';

    const refused = await runtime.start({ ...scope(conversation), prompt: 'Fix it' });
    expect(refused).toMatchObject({ ok: false, error: { code: 'disabled' } });
    await expect(runtime.state(scope(conversation))).resolves.toBeNull();

    await runtime.start({ ...scope(conversation), prompt: 'Retry' });
    expect(start).toHaveBeenCalledTimes(2);
    await runtime.release(scope(conversation));
  });

  it('releases only the handle that owns the lease', async () => {
    const run = handle('session-owned');
    const start = jest.fn(async () => ({ ok: true as const, value: run }));
    const runtime = new EngineWorkChatRuntime(fakeRegistry(start), roots);
    const conversation = 'conversation-g';
    await runtime.start({ ...scope(conversation), prompt: 'Fix it' });

    await expect(
      runtime.release({ ...scope(conversation), handle: handle('session-other') }),
    ).resolves.toBe(false);
    await expect(runtime.state(scope(conversation))).resolves.toBe('running');
    await expect(runtime.release({ ...scope(conversation), handle: run })).resolves.toBe(true);
    await expect(runtime.state(scope(conversation))).resolves.toBeNull();
  });

  it('waits for readiness before taking the registry snapshot', async () => {
    const registry = fakeRegistry(jest.fn());
    const snapshot = jest.spyOn(registry, 'snapshot');
    let finishProbe!: () => void;
    jest.spyOn(registry, 'probe').mockReturnValue(
      new Promise((resolve) => {
        finishProbe = resolve;
      }),
    );
    const runtime = new EngineWorkChatRuntime(registry, roots);
    const refreshed = runtime.refreshSnapshot();
    expect(snapshot).not.toHaveBeenCalled();
    finishProbe();
    await expect(refreshed).resolves.toEqual({ defaultEngine: 'opencode', engines: [] });
  });

  it('reads run state and accepts cancellation for a run owned by another replica', async () => {
    const leases = createMemoryWorkRunLeaseStore();
    const start = jest.fn();
    const runtime = new EngineWorkChatRuntime(
      fakeRegistry(start),
      roots,
      'private',
      undefined,
      'opencode',
      leases,
      LEASE_TTL_MS,
    );
    const conversation = 'conversation-remote';
    await leases.claim(scope(conversation), {
      token: 'remote-token',
      owner: 'replica-2',
      now: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(runtime.state(scope(conversation))).resolves.toBe('running');
    await expect(
      runtime.start({ ...scope(conversation), prompt: 'Second' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'busy' } });
    await expect(runtime.cancel(scope(conversation))).resolves.toBe(true);
    /** The flag is durable, so every replica now sees the run as cancelled. */
    await expect(runtime.state(scope(conversation))).resolves.toBe('cancelled');
  });

  it('reclaims a run left behind by a previous process after a restart', async () => {
    const leases = createMemoryWorkRunLeaseStore();
    const start = jest.fn(async () => ({ ok: true as const, value: handle('session-restart') }));
    const runtime = new EngineWorkChatRuntime(
      fakeRegistry(start),
      roots,
      'private',
      undefined,
      'opencode',
      leases,
      LEASE_TTL_MS,
    );
    const conversation = 'conversation-restart';
    /** The previous boot never released its lease and stopped heartbeating. */
    await leases.claim(scope(conversation), {
      token: 'dead-token',
      owner: 'previous-boot',
      now: new Date(Date.now() - 120_000),
      expiresAt: new Date(Date.now() - 60_000),
    });

    /** A restart is not a user cancellation: the interrupted run failed. */
    await expect(runtime.state(scope(conversation))).resolves.toBe('failed');
    await expect(
      runtime.start({ ...scope(conversation), prompt: 'Resume' }),
    ).resolves.toMatchObject({ ok: true });
    await expect(runtime.state(scope(conversation))).resolves.toBe('running');

    await runtime.release(scope(conversation));
  });

  it('reclaims dead lease rows in bounded batches when run traffic arrives', async () => {
    const memory = createMemoryWorkRunLeaseStore();
    const prune = jest.fn(memory.prune);
    const leases = { ...memory, prune };
    const start = jest.fn(async () => ({ ok: true as const, value: handle('session-sweep') }));
    const runtime = new EngineWorkChatRuntime(
      fakeRegistry(start),
      roots,
      'private',
      undefined,
      'opencode',
      leases,
      LEASE_TTL_MS,
    );
    /** An abandoned task whose owner died long before the retention window. */
    const deadAt = new Date(Date.now() - 2 * DEFAULT_WORK_RUN_RETENTION_MS);
    await leases.claim(scope('conversation-abandoned'), {
      token: 'dead-token',
      owner: 'previous-boot',
      now: deadAt,
      expiresAt: deadAt,
    });

    await runtime.start({ ...scope('conversation-swept'), prompt: 'Fix it' });

    await waitFor(() => prune.mock.calls.length > 0);
    const [cutoff, limit] = prune.mock.calls[0] as [Date, number];
    expect(limit).toBe(WORK_RUN_SWEEP_LIMIT);
    expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now() - DEFAULT_WORK_RUN_RETENTION_MS);
    await (prune.mock.results[0]?.value as Promise<number>);
    await expect(runtime.state(scope('conversation-abandoned'))).resolves.toBeNull();

    await runtime.release(scope('conversation-swept'));
  });

  it('aborts a live run when another replica requests cancellation', async () => {
    const leases = createMemoryWorkRunLeaseStore();
    const run = handle('session-lease');
    const start = jest.fn(async () => ({ ok: true as const, value: run }));
    const runtime = new EngineWorkChatRuntime(
      fakeRegistry(start),
      roots,
      'private',
      undefined,
      'opencode',
      leases,
      LEASE_TTL_MS,
    );
    const conversation = 'conversation-cancelled-elsewhere';

    await runtime.start({ ...scope(conversation), prompt: 'Fix it' });
    await expect(leases.cancel(scope(conversation), new Date())).resolves.toBe('requested');
    await waitFor(() => (run.cancel as jest.Mock).mock.calls.length > 0);

    await runtime.release(scope(conversation));
    await expect(runtime.state(scope(conversation))).resolves.toBeNull();
  });

  it('reads the claimed lease token and the run state from one snapshot', async () => {
    const leases = createMemoryWorkRunLeaseStore();
    const start = jest.fn(async () => ({ ok: true as const, value: handle('session-generation') }));
    const runtime = new EngineWorkChatRuntime(
      fakeRegistry(start),
      roots,
      'private',
      undefined,
      'opencode',
      leases,
      LEASE_TTL_MS,
    );
    const conversation = 'conversation-generation';

    await expect(runtime.inspect(scope(conversation))).resolves.toEqual({
      state: null,
      generation: null,
    });
    await runtime.start({ ...scope(conversation), prompt: 'Fix it' });
    const lease = await leases.read(scope(conversation), new Date());
    expect(lease?.token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    await expect(runtime.inspect(scope(conversation))).resolves.toEqual({
      state: 'running',
      generation: lease?.token,
    });

    await runtime.release(scope(conversation));
    await expect(runtime.inspect(scope(conversation))).resolves.toEqual({
      state: null,
      generation: null,
    });
  });

  it('refuses a second replica that shares the same lease store', async () => {
    const leases = createMemoryWorkRunLeaseStore();
    const start = jest.fn(async () => ({ ok: true as const, value: handle('session-replica-a') }));
    const first = new EngineWorkChatRuntime(
      fakeRegistry(start),
      roots,
      'private',
      undefined,
      'opencode',
      leases,
      LEASE_TTL_MS,
    );
    const second = new EngineWorkChatRuntime(
      fakeRegistry(start),
      roots,
      'private',
      undefined,
      'opencode',
      leases,
      LEASE_TTL_MS,
    );
    const conversation = 'conversation-replicas';

    await expect(first.start({ ...scope(conversation), prompt: 'First' })).resolves.toMatchObject({
      ok: true,
    });
    await expect(second.start({ ...scope(conversation), prompt: 'Second' })).resolves.toMatchObject(
      {
        ok: false,
        error: { code: 'busy' },
      },
    );

    await first.release(scope(conversation));
  });

  it('keeps renewing the lease while startup outlasts the lease TTL', async () => {
    const leases = createMemoryWorkRunLeaseStore();
    const run = handle('session-slow-start');
    const start = jest.fn(async (input: Parameters<EngineRegistryApi['start']>[0]) => {
      await input.beforeDispatch?.();
      return { ok: true as const, value: run };
    });
    const runtime = new EngineWorkChatRuntime(
      fakeRegistry(start),
      roots,
      'private',
      undefined,
      'opencode',
      leases,
      LEASE_TTL_MS,
    );
    const conversation = 'conversation-slow-start';
    let ownership: { generation: string | null; replaces: string | null } | undefined;

    const started = await runtime.start({
      ...scope(conversation),
      prompt: 'Fix it',
      beforeDispatch: async (claimed) => {
        ownership = claimed;
        await new Promise((resolve) => setTimeout(resolve, LEASE_TTL_MS * 4));
      },
    });

    expect(started.ok).toBe(true);
    expect(ownership?.generation).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    /** The heartbeat renewed through startup, so the task never became claimable. */
    await expect(runtime.state(scope(conversation))).resolves.toBe('running');
    await expect(
      new EngineWorkChatRuntime(
        fakeRegistry(start),
        roots,
        'private',
        undefined,
        'opencode',
        leases,
        LEASE_TTL_MS,
      ).start({ ...scope(conversation), prompt: 'Second' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'busy' } });

    await runtime.release(scope(conversation));
  });

  it('reports the expired generation a takeover replaced', async () => {
    const leases = createMemoryWorkRunLeaseStore();
    const start = jest.fn(async (input: Parameters<EngineRegistryApi['start']>[0]) => {
      await input.beforeDispatch?.();
      return { ok: true as const, value: handle('session-takeover') };
    });
    const runtime = new EngineWorkChatRuntime(
      fakeRegistry(start),
      roots,
      'private',
      undefined,
      'opencode',
      leases,
      LEASE_TTL_MS,
    );
    const conversation = 'conversation-takeover';
    await leases.claim(scope(conversation), {
      token: 'dead-token',
      owner: 'previous-boot',
      now: new Date(Date.now() - 120_000),
      expiresAt: new Date(Date.now() - 60_000),
    });
    let ownership: { generation: string | null; replaces: string | null } | undefined;

    await runtime.start({
      ...scope(conversation),
      prompt: 'Resume',
      beforeDispatch: async (claimed) => {
        ownership = claimed;
      },
    });

    expect(ownership?.replaces).toBe('dead-token');
    expect(ownership?.generation).not.toBe('dead-token');
    await runtime.release(scope(conversation));
  });

  it('cancels only the generation the caller observed', async () => {
    const leases = createMemoryWorkRunLeaseStore();
    const run = handle('session-bound-cancel');
    const start = jest.fn(async () => ({ ok: true as const, value: run }));
    const runtime = new EngineWorkChatRuntime(
      fakeRegistry(start),
      roots,
      'private',
      undefined,
      'opencode',
      leases,
      LEASE_TTL_MS,
    );
    const conversation = 'conversation-bound-cancel';
    await runtime.start({ ...scope(conversation), prompt: 'Fix it' });
    const snapshot = await runtime.inspect(scope(conversation));

    await expect(runtime.cancel(scope(conversation), 'replacement-token')).resolves.toBe(false);
    expect(run.cancel).not.toHaveBeenCalled();
    await expect(
      runtime.cancel(scope(conversation), snapshot.generation ?? undefined),
    ).resolves.toBe(true);
    expect(run.cancel).toHaveBeenCalled();

    await runtime.release(scope(conversation));
  });

  it('keeps the lease until engine-side cleanup settles', async () => {
    const leases = createMemoryWorkRunLeaseStore();
    const run = handle('session-cleanup');
    let finishCleanup!: () => void;
    run.cleanup = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    const start = jest.fn(async () => ({ ok: true as const, value: run }));
    const runtime = new EngineWorkChatRuntime(
      fakeRegistry(start),
      roots,
      'private',
      undefined,
      'opencode',
      leases,
      LEASE_TTL_MS,
    );
    const conversation = 'conversation-cleanup';

    await runtime.start({ ...scope(conversation), prompt: 'Fix it' });
    await expect(runtime.release(scope(conversation))).resolves.toBe(true);
    /** Another replica must not start beside an abort that is still cleaning up. */
    await expect(runtime.state(scope(conversation))).resolves.toBe('running');

    finishCleanup();
    await waitForState(runtime, scope(conversation), null);
  });

  it('releases the lease after a failed engine cleanup', async () => {
    const leases = createMemoryWorkRunLeaseStore();
    const run = handle('session-failed-cleanup');
    run.cleanup = Promise.reject(new Error('cleanup failed'));
    await run.cleanup.catch(() => undefined);
    const start = jest.fn(async () => ({ ok: true as const, value: run }));
    const runtime = new EngineWorkChatRuntime(
      fakeRegistry(start),
      roots,
      'private',
      undefined,
      'opencode',
      leases,
      LEASE_TTL_MS,
    );
    const conversation = 'conversation-failed-cleanup';

    await runtime.start({ ...scope(conversation), prompt: 'Fix it' });
    await expect(runtime.release(scope(conversation))).resolves.toBe(true);
    await waitForState(runtime, scope(conversation), null);
  });

  it('stops the run when a lease-store outage outlasts the confirmed expiry', async () => {
    const memory = createMemoryWorkRunLeaseStore();
    const leases = {
      ...memory,
      renew: jest.fn(async () => {
        throw new Error('lease store down');
      }),
    };
    const run = handle('session-outage');
    const start = jest.fn(async () => ({ ok: true as const, value: run }));
    const runtime = new EngineWorkChatRuntime(
      fakeRegistry(start),
      roots,
      'private',
      undefined,
      'opencode',
      leases,
      LEASE_TTL_MS,
    );
    const conversation = 'conversation-outage';

    await runtime.start({ ...scope(conversation), prompt: 'Fix it' });
    await waitFor(() => (run.cancel as jest.Mock).mock.calls.length > 0);
    await expect(runtime.state(scope(conversation))).resolves.toBe('failed');
  });
});
