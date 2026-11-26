import express from 'express';
import { z as zod } from 'zod';
import type { NextFunction, Request, Response, Router } from 'express';
import type { z } from 'zod';
import type { ResolvedGatewayConfig, WorkflowEngineGatewayOptions } from './config';
import type { OwnerGateResult, OwnerIdentity } from './auth';
import type { GatewayConfigFailure } from './config';
import type { CompatibilityReport } from './compat';
import type { GatewayFetch } from './client';
import { createEngineClient, GatewayTransportError } from './client';
import { resolveGatewayConfig } from './config';
import { checkCompatibility } from './compat';
import { contractSchemas } from './contracts';
import { requireOwner } from './auth';

const schemas = contractSchemas();

/**
 * The authenticated Coderax-side WorkflowEngine proxy.
 *
 * One rule dominates every route: the browser never talks to the engine and never
 * sees its credential. Coderax authenticates the owner, resolves the transport
 * from server configuration, performs the contract handshake, then forwards a
 * validated request with the server-held bearer token. Every failure is
 * fail-closed and uses a stable code; the gateway never substitutes another
 * engine, never retries a mutation, and never derives owner identity from input.
 *
 * The transport is reversible: `workflowEngine.enabled` false answers 503 and
 * leaves every existing Coderax route untouched.
 */

export type WorkflowEngineGatewayLogger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

export type WorkflowEngineGatewayDeps = {
  resolveConfig: (req: Request) => WorkflowEngineGatewayOptions | null | undefined;
  env?: NodeJS.ProcessEnv;
  fetch?: GatewayFetch;
  logger?: WorkflowEngineGatewayLogger;
  /** Injectable for tests; production always uses the owner gate above. */
  requireOwner?: (req: Pick<Request, 'user'>) => OwnerGateResult;
};

export type WorkflowEngineGateway = {
  router: Router;
  /** Performs the startup handshake once for the configured transport. */
  prewarm: (options?: WorkflowEngineGatewayOptions | null) => Promise<CompatibilityReport | null>;
  reset: () => void;
};

type GatewayContext = {
  owner: OwnerIdentity;
  config: Extract<ResolvedGatewayConfig, { enabled: true }>;
  client: ReturnType<typeof createEngineClient>;
  compatibility: CompatibilityReport;
};

const CONTEXT = 'workflowEngine';
const COMPATIBILITY_TTL_MS = 60_000;
const NO_STORE = { 'Cache-Control': 'no-store' };

class GatewayRequestError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super('gateway request failed');
    this.status = status;
    this.body = body;
  }
}

function unsupported(detail: string): GatewayRequestError {
  return new GatewayRequestError(501, { code: 'WORKFLOW_ENGINE_UNSUPPORTED', detail });
}

function capabilityFailure(missing: readonly string[]): GatewayRequestError {
  return unsupported(
    `The connected WorkflowEngine does not advertise: ${missing.join(', ')}. ` +
      'This gateway refuses the operation rather than degrading it silently.',
  );
}

function configFailure(failure: GatewayConfigFailure): GatewayRequestError {
  return new GatewayRequestError(503, { code: failure.code, detail: failure.detail });
}

function isSafePathIdentifier(value: string): boolean {
  return (
    value.length > 0 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.includes('\u0000')
  );
}

function transportFailure(error: GatewayTransportError): GatewayRequestError {
  return new GatewayRequestError(error.status ?? 502, {
    code: 'WORKFLOW_ENGINE_ERROR',
    engineCode: error.code,
    retryable: error.retryable,
    ...(error.requestId == null ? {} : { requestId: error.requestId }),
    ...(error.detail == null ? {} : { detail: error.detail }),
  });
}

export function createWorkflowEngineGateway(
  deps: WorkflowEngineGatewayDeps,
): WorkflowEngineGateway {
  const env = deps.env ?? process.env;
  const ownerGate = deps.requireOwner ?? requireOwner;
  const router = express.Router();

  let cache: {
    fingerprint: string;
    config: Extract<ResolvedGatewayConfig, { enabled: true }>;
    client: ReturnType<typeof createEngineClient>;
    compatibility: Promise<CompatibilityReport>;
    checkedAtMs: number;
  } | null = null;

  function contextFor(config: Extract<ResolvedGatewayConfig, { enabled: true }>) {
    // The token is compared separately so a rotated credential rebuilds the
    // client without putting the secret value into the cache key.
    if (
      cache != null &&
      cache.fingerprint === config.fingerprint &&
      cache.config.token === config.token
    ) {
      if (Date.now() - cache.checkedAtMs > COMPATIBILITY_TTL_MS) {
        const entry = cache;
        entry.checkedAtMs = Date.now();
        entry.compatibility = checkCompatibility(entry.client).catch((error: unknown) => {
          cache = null;
          throw error;
        });
      }
      return cache;
    }
    const client = createEngineClient({
      baseURL: config.baseURL,
      token: config.token,
      contractVersion: config.contractVersion,
      requestTimeoutMs: config.requestTimeoutMs,
      streamIdleTimeoutMs: config.streamIdleTimeoutMs,
      ...(deps.fetch == null ? {} : { fetch: deps.fetch }),
    });
    const compatibility = checkCompatibility(client).catch((error: unknown) => {
      // A transient outage must not permanently brick the transport, but the
      // failed check is never cached as success.
      cache = null;
      throw error;
    });
    cache = {
      fingerprint: config.fingerprint,
      config,
      client,
      compatibility,
      checkedAtMs: Date.now(),
    };
    return cache;
  }

  router.use((req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      const owner = ownerGate(req);
      if (!owner.ok) {
        res.set(NO_STORE).status(owner.status).json({ code: owner.code });
        return;
      }
      const resolved = resolveGatewayConfig(deps.resolveConfig(req), env);
      if (!resolved.ok) {
        const failure = configFailure(resolved);
        res.set(NO_STORE).status(failure.status).json(failure.body);
        return;
      }
      if (!resolved.value.enabled) {
        res.set(NO_STORE).status(503).json({
          code: 'WORKFLOW_ENGINE_DISABLED',
          detail: 'The WorkflowEngine gateway is disabled in this deployment.',
        });
        return;
      }
      const entry = contextFor(resolved.value);
      const compatibility = await entry.compatibility;
      const context: GatewayContext = {
        owner: owner.value,
        config: entry.config,
        client: entry.client,
        compatibility,
      };
      res.locals[CONTEXT] = context;
      next();
    })().catch(next);
  });

  const handle =
    (handler: (req: Request, res: Response, context: GatewayContext) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction): void => {
      const context = res.locals[CONTEXT] as GatewayContext | undefined;
      if (context == null) {
        res.status(500).json({ code: 'WORKFLOW_ENGINE_CONTEXT_MISSING' });
        return;
      }
      handler(req, res, context).catch(next);
    };

  const parseBody = <T extends z.ZodTypeAny>(
    schema: T,
    req: Request,
    res: Response,
  ): z.infer<T> | null => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res
        .set(NO_STORE)
        .status(400)
        .json({
          code: 'WORKFLOW_ENGINE_INVALID_REQUEST',
          issues: result.error.issues.map((issue) => issue.path.join('.') || 'body'),
        });
      return null;
    }
    return result.data;
  };

  const stream = async (
    res: Response,
    signal: AbortSignal,
    frames: AsyncIterable<unknown>,
  ): Promise<void> => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const write = async (chunk: string): Promise<boolean> => {
      if (res.writableEnded || signal.aborted) {
        return false;
      }
      if (res.write(chunk)) {
        return true;
      }
      // Wait for the slow client instead of buffering upstream frames without
      // bound; a closed connection ends the wait and the stream.
      await new Promise<void>((resolve) => {
        const done = (): void => {
          res.off('drain', done);
          res.off('close', done);
          resolve();
        };
        res.once('drain', done);
        res.once('close', done);
      });
      return !res.writableEnded && !signal.aborted;
    };

    try {
      for await (const frame of frames) {
        if (!(await write(`data: ${JSON.stringify(frame)}\n\n`))) {
          break;
        }
      }
    } catch (error) {
      if (!res.writableEnded && !signal.aborted) {
        const failure =
          error instanceof GatewayTransportError
            ? transportFailure(error).body
            : { code: 'WORKFLOW_ENGINE_PROTOCOL_ERROR' };
        await write(`event: error\ndata: ${JSON.stringify(failure)}\n\n`);
      }
    } finally {
      res.end();
    }
  };

  router.get(
    '/contract',
    handle(async (_req, res, context) => {
      res.set(NO_STORE).status(200).json({
        pinnedContractVersion: context.client.expectedContractVersion,
        engineContractVersion: context.compatibility.contractVersion,
        capabilities: context.compatibility.capabilities,
        engineStatus: context.compatibility.engineStatus,
        checkedAt: context.compatibility.checkedAt,
      });
    }),
  );

  router.get(
    '/health',
    handle(async (_req, res, context) => {
      const health = await context.client.health();
      res
        .set(NO_STORE)
        .status(200)
        .json({
          gateway: {
            enabled: true,
            tokenEnv: context.config.tokenEnv,
            pinnedContractVersion: context.client.expectedContractVersion,
          },
          compatibility: context.compatibility,
          engine: health,
        });
    }),
  );

  router.get(
    '/ready',
    handle(async (_req, res, context) => {
      const body = {
        contractVersion: context.compatibility.contractVersion,
        capabilities: context.compatibility.capabilities,
      };
      try {
        const readiness = await context.client.readiness();
        res
          .set(NO_STORE)
          .status(readiness.ready ? 200 : 503)
          .json({ ready: readiness.ready, missing: readiness.missing, ...body });
      } catch (error) {
        // A reachable-but-not-ready engine is a different answer from an
        // unreachable one; only the latter reaches the shared error handler.
        if (error instanceof GatewayTransportError && error.code === 'not_ready') {
          res
            .set(NO_STORE)
            .status(503)
            .json({ ready: false, missing: [], ...body });
          return;
        }
        throw error;
      }
    }),
  );

  router.get(
    '/agents',
    handle(async (_req, res, context) => {
      res
        .set(NO_STORE)
        .status(200)
        .json(await context.client.listAgents());
    }),
  );

  router.get(
    '/models',
    handle(async (_req, res, context) => {
      res
        .set(NO_STORE)
        .status(200)
        .json(await context.client.listModels());
    }),
  );

  router.get(
    '/conversations',
    handle(async (_req, res, context) => {
      res
        .set(NO_STORE)
        .status(200)
        .json(await context.client.listConversations());
    }),
  );

  router.get(
    '/conversations/:conversationId',
    handle(async (req, res, context) => {
      const conversationId = req.params.conversationId;
      // `identifier()` accepts `.` and `..`; URL normalisation would then retarget
      // the owner request to a different upstream path.
      if (!isSafePathIdentifier(conversationId)) {
        res.set(NO_STORE).status(400).json({
          code: 'WORKFLOW_ENGINE_INVALID_REQUEST',
          detail: 'The conversation id is not a valid identifier.',
        });
        return;
      }
      res
        .set(NO_STORE)
        .status(200)
        .json(await context.client.getConversation(conversationId));
    }),
  );

  router.get(
    '/memory',
    handle(async (req, res, context) => {
      const query = zod
        .object({ mode: zod.enum(['private', 'cloud']).default('private') })
        .safeParse(req.query);
      if (!query.success) {
        res.set(NO_STORE).status(400).json({ code: 'WORKFLOW_ENGINE_INVALID_REQUEST' });
        return;
      }
      res
        .set(NO_STORE)
        .status(200)
        .json(await context.client.listMemory(query.data.mode));
    }),
  );

  router.get(
    '/notifications',
    handle(async (_req, res, context) => {
      res
        .set(NO_STORE)
        .status(200)
        .json(await context.client.listNotifications());
    }),
  );

  router.get(
    '/tasks',
    handle(async (_req, _res) => {
      throw unsupported(
        'Contract 1.0.0 has no task-list operation. Read conversations, then one task by id.',
      );
    }),
  );

  router.get(
    '/tasks/:taskId',
    handle(async (req, res, context) => {
      res
        .set(NO_STORE)
        .status(200)
        .json(await context.client.getTask(req.params.taskId));
    }),
  );

  router.get(
    '/tasks/:taskId/artifacts',
    handle(async (req, res, context) => {
      const task = await context.client.getTask(req.params.taskId);
      res
        .set(NO_STORE)
        .status(200)
        .json({
          taskId: task.taskId,
          artifacts: task.result?.artifacts ?? [],
          /** Metadata only: contract 1.0.0 exposes no artifact-content route. */
          content: 'unsupported',
          ...(task.result == null ? { available: false } : { available: true }),
        });
    }),
  );

  router.post(
    '/chat',
    handle(async (req, res, context) => {
      const body = parseBody(schemas.ChatRequest, req, res);
      if (body == null) {
        return;
      }
      const controller = new AbortController();
      res.on('close', () => controller.abort());
      const outcome = await context.client.submitChat(body, controller.signal);
      if (outcome.kind === 'json') {
        res.set(NO_STORE).status(200).json(outcome.reply);
        return;
      }
      await stream(res, controller.signal, outcome.frames);
    }),
  );

  router.post(
    '/work',
    handle(async (req, res, context) => {
      if (!context.compatibility.workCapable) {
        throw unsupported(
          'No available WorkflowEngine engine advertises every Work capability (durable, cancellation, resume).',
        );
      }
      const body = parseBody(schemas.WorkSubmitRequest, req, res);
      if (body == null) {
        return;
      }
      const accepted = await context.client.submitWork(body);
      res.set(NO_STORE).status(202).json(accepted);
    }),
  );

  router.post(
    '/tasks/:taskId/cancel',
    handle(async (req, res, context) => {
      if (!context.compatibility.capabilities.cancellation) {
        throw capabilityFailure(['cancellation']);
      }
      const body = parseBody(schemas.CancelRequest, req, res);
      if (body == null) {
        return;
      }
      res
        .set(NO_STORE)
        .status(200)
        .json(await context.client.cancelTask(req.params.taskId, body));
    }),
  );

  router.post(
    '/tasks/:taskId/resume',
    handle(async (req, res, context) => {
      if (!context.compatibility.capabilities.resume) {
        throw capabilityFailure(['resume']);
      }
      const body = parseBody(schemas.ResumeRequest, req, res);
      if (body == null) {
        return;
      }
      res
        .set(NO_STORE)
        .status(200)
        .json(await context.client.resumeTask(req.params.taskId, body));
    }),
  );

  router.post(
    '/tasks/:taskId/retry',
    handle(async (req, res, context) => {
      if (!context.compatibility.capabilities.durable) {
        throw capabilityFailure(['durable']);
      }
      const body = parseBody(schemas.RetryRequest, req, res);
      if (body == null) {
        return;
      }
      res
        .set(NO_STORE)
        .status(200)
        .json(await context.client.retryTask(req.params.taskId, body));
    }),
  );

  router.get(
    '/tasks/:taskId/events',
    handle(async (req, res, context) => {
      const query = zod
        .object({ after: zod.coerce.number().int().nonnegative().default(0) })
        .safeParse(req.query);
      if (!query.success) {
        res.set(NO_STORE).status(400).json({ code: 'WORKFLOW_ENGINE_INVALID_REQUEST' });
        return;
      }
      const controller = new AbortController();
      res.on('close', () => controller.abort());
      await stream(
        res,
        controller.signal,
        context.client.streamTaskEvents(req.params.taskId, query.data.after, controller.signal),
      );
    }),
  );

  router.get(
    '/tasks/:taskId/permissions',
    handle(async (req, res, context) => {
      res
        .set(NO_STORE)
        .status(200)
        .json(await context.client.listPermissions(req.params.taskId));
    }),
  );

  router.post(
    '/tasks/:taskId/permissions',
    handle(async (req, res, context) => {
      const body = parseBody(schemas.PermissionDecisionRequest, req, res);
      if (body == null) {
        return;
      }
      res
        .set(NO_STORE)
        .status(200)
        .json(await context.client.decidePermission(req.params.taskId, body));
    }),
  );

  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    // Express recognises an error handler by its four-argument signature.
    void next;
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof GatewayRequestError) {
      res.set(NO_STORE).status(error.status).json(error.body);
      return;
    }
    if (error instanceof GatewayTransportError) {
      const failure = transportFailure(error);
      res.set(NO_STORE).status(failure.status).json(failure.body);
      return;
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { name?: unknown }).name === 'GatewayCompatibilityError'
    ) {
      const code = (error as { code?: string }).code ?? 'protocol_error';
      const message = (error as { message?: string }).message ?? 'Compatibility failed.';
      deps.logger?.error?.(`[workflow-engine] compatibility refused: ${code}`);
      res
        .set(NO_STORE)
        .status(503)
        .json({
          code: `WORKFLOW_ENGINE_${code.toUpperCase()}`,
          detail: message,
        });
      return;
    }
    deps.logger?.error?.('[workflow-engine] request failed');
    res.set(NO_STORE).status(502).json({ code: 'WORKFLOW_ENGINE_UNAVAILABLE' });
  });

  async function prewarm(
    options?: WorkflowEngineGatewayOptions | null,
  ): Promise<CompatibilityReport | null> {
    const resolved = resolveGatewayConfig(options, env);
    if (!resolved.ok) {
      deps.logger?.warn?.(`[workflow-engine] ${resolved.code}`);
      return null;
    }
    if (!resolved.value.enabled) {
      return null;
    }
    if (!resolved.value.startupCheck) {
      deps.logger?.info?.('[workflow-engine] startup compatibility check is disabled.');
      return null;
    }
    const entry = contextFor(resolved.value);
    try {
      const report = await entry.compatibility;
      deps.logger?.info?.(
        `[workflow-engine] contract ${report.contractVersion} verified; engine ${report.engineStatus}`,
      );
      return report;
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code: unknown }).code)
          : 'unknown';
      deps.logger?.error?.(`[workflow-engine] startup compatibility check failed: ${code}`);
      return null;
    }
  }

  return {
    router,
    prewarm,
    reset: () => {
      cache = null;
    },
  };
}
