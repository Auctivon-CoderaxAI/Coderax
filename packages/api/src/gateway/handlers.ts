import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { ExecutionEvent, GatewayCapability, TaskAccepted } from './contracts';
import type { CapabilityNegotiation } from './negotiation';
import type { EngineHttpClient } from './client';
import type { GatewayService } from './service';
import type { GatewayConfig } from './config';
import type { GatewayResult } from './errors';
import {
  assertClientContractVersion,
  assertRequiredCapabilities,
  createCapabilityNegotiation,
  parseCapabilityHeader,
} from './negotiation';
import { readGatewayToken, resolveGatewayConfig } from './config';
import { fail, gatewayError, ok, toProblem } from './errors';
import { createTransportSelector } from './transport';
import { createHttpEngineClient } from './client';
import { createGatewayService } from './service';
import { CONTRACT_VERSION } from './contracts';

/**
 * Express handlers for the authenticated gateway.
 *
 * Wiring (route paths, mounting, the JWT middleware) stays in `/api`; every
 * decision — owner check, transport authority, capability availability,
 * validation, streaming and error mapping — lives here so it can be unit tested
 * and cannot drift into a CJS route file.
 */

export type GatewayLogger = {
  warn?: (message: string, meta?: Record<string, unknown>) => void;
  error?: (message: string, meta?: Record<string, unknown>) => void;
};

export type GatewayHandlerDeps = {
  env: NodeJS.ProcessEnv;
  isOwner: (user: unknown) => boolean;
  now?: () => Date;
  logger?: GatewayLogger;
  /** Test seam; production always uses the real HTTP client. */
  createClient?: (input: { config: GatewayConfig; token: string }) => EngineHttpClient;
};

export type GatewayHandlers = {
  requireOwner: (req: Request, res: Response, next: NextFunction) => void;
  meta: (req: Request, res: Response) => Promise<void>;
  health: (req: Request, res: Response) => Promise<void>;
  readiness: (req: Request, res: Response) => Promise<void>;
  agents: (req: Request, res: Response) => Promise<void>;
  models: (req: Request, res: Response) => Promise<void>;
  chat: (req: Request, res: Response) => Promise<void>;
  submitWork: (req: Request, res: Response) => Promise<void>;
  getTask: (req: Request, res: Response) => Promise<void>;
  artifacts: (req: Request, res: Response) => Promise<void>;
  cancel: (req: Request, res: Response) => Promise<void>;
  resume: (req: Request, res: Response) => Promise<void>;
  retry: (req: Request, res: Response) => Promise<void>;
  events: (req: Request, res: Response) => Promise<void>;
  conversations: (req: Request, res: Response) => Promise<void>;
  conversation: (req: Request, res: Response) => Promise<void>;
  memory: (req: Request, res: Response) => Promise<void>;
  permissions: (req: Request, res: Response) => Promise<void>;
  decidePermission: (req: Request, res: Response) => Promise<void>;
  notifications: (req: Request, res: Response) => Promise<void>;
  scheduling: (req: Request, res: Response) => Promise<void>;
};

type Runtime = {
  service: GatewayService;
  negotiation: CapabilityNegotiation;
  fingerprint: string;
};

type GatewayContext = {
  service: GatewayService;
  negotiation: CapabilityNegotiation;
  config: GatewayConfig;
};

const MAX_EVENT_FRAME_BYTES = 1_048_576;
const HEARTBEAT_MS = 15_000;

function requestId(req: Request): string | undefined {
  const raw = req.get('x-request-id');
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return /^[A-Za-z0-9_.:-]{1,128}$/.test(trimmed) ? trimmed : undefined;
}

function acceptsSse(req: Request): boolean {
  const accept = req.get('accept') ?? '';
  return accept.includes('text/event-stream');
}

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseAfter(req: Request, lastEventIdHeader?: string): GatewayResult<number> {
  const fromQuery = queryString(req.query.after);
  const fromHeader = queryString(lastEventIdHeader ?? req.get('last-event-id'));
  const raw = fromQuery ?? fromHeader;
  if (raw == null) {
    return ok(0);
  }
  if (!/^\d{1,12}$/.test(raw)) {
    return fail(
      gatewayError('validation_failed', {
        detail: 'after must be a non-negative integer sequence cursor',
        ...(requestId(req) ? { requestId: requestId(req) } : {}),
      }),
    );
  }
  return ok(Number.parseInt(raw, 10));
}

function sendFailure(res: Response, error: ReturnType<typeof gatewayError>): void {
  if (res.headersSent) {
    if (!res.writableEnded) {
      res.end();
    }
    return;
  }
  res.status(error.status).json(toProblem(error));
}

function setGatewayHeaders(res: Response): void {
  res.setHeader('x-coderax-contract-version', CONTRACT_VERSION);
  res.setHeader('cache-control', 'no-store');
  res.setHeader('vary', 'Authorization');
}

function beginSse(res: Response): void {
  res.status(200);
  res.setHeader('content-type', 'text/event-stream; charset=utf-8');
  res.setHeader('cache-control', 'no-store, no-transform');
  res.setHeader('connection', 'keep-alive');
  res.setHeader('x-accel-buffering', 'no');
  res.setHeader('x-coderax-contract-version', CONTRACT_VERSION);
  res.flushHeaders?.();
}

function writeFrame(res: Response, payload: unknown, seq?: number): boolean {
  if (res.writableEnded || res.destroyed) {
    return false;
  }
  if (seq !== undefined) {
    res.write(`id: ${seq}\n`);
  }
  const body = JSON.stringify(payload);
  if (body.length > MAX_EVENT_FRAME_BYTES) {
    return false;
  }
  res.write(`data: ${body}\n\n`);
  return true;
}

function fingerprint(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

export function createGatewayHandlers(deps: GatewayHandlerDeps): GatewayHandlers {
  const runtimes = new Map<string, Runtime>();

  function resolveConfig(req: Request): GatewayResult<GatewayConfig> {
    const raw = (req as Request & { config?: { gateway?: unknown } }).config?.gateway;
    try {
      return ok(resolveGatewayConfig(raw));
    } catch {
      // Configuration details are owner-safe, but the credential name is not
      // needed to explain the failure; keep it out of the response.
      return fail(
        gatewayError('gateway_disabled', {
          detail: 'the WorkflowEngine gateway configuration is invalid',
          retryable: false,
        }),
      );
    }
  }

  function runtimeFor(config: GatewayConfig): GatewayResult<GatewayContext> {
    if (!config.enabled) {
      return fail(
        gatewayError('gateway_disabled', {
          detail: 'the WorkflowEngine gateway is not enabled for this deployment',
          retryable: false,
        }),
      );
    }
    if (config.baseUrl == null) {
      return fail(
        gatewayError('gateway_disabled', {
          detail: 'the WorkflowEngine gateway has no configured base URL',
          retryable: false,
        }),
      );
    }
    const token = readGatewayToken(config, deps.env);
    if (token == null) {
      return fail(
        gatewayError('engine_not_configured', {
          detail: 'the WorkflowEngine credential is not present in the server environment',
          retryable: false,
        }),
      );
    }

    const key = `${config.baseUrl}|${config.tokenEnv}|${config.timeoutMs}`;
    const print = fingerprint(token);
    const cached = runtimes.get(key);
    if (cached != null && cached.fingerprint === print) {
      return ok({
        service: cached.service,
        negotiation: cached.negotiation,
        config,
      });
    }

    const client =
      deps.createClient?.({ config, token }) ??
      createHttpEngineClient({
        baseUrl: config.baseUrl,
        token,
        timeoutMs: config.timeoutMs,
      });
    const negotiation = createCapabilityNegotiation({
      client,
      ttlMs: config.healthTtlMs,
      ...(deps.now ? { now: deps.now } : {}),
    });
    const service = createGatewayService({
      client,
      negotiation,
      transport: createTransportSelector(config),
      config,
    });
    runtimes.set(key, { service, negotiation, fingerprint: print });
    return ok({ service, negotiation, config });
  }

  async function enter(
    req: Request,
    required: readonly GatewayCapability[] = [],
  ): Promise<GatewayResult<{ service: GatewayService; config: GatewayConfig }>> {
    const config = resolveConfig(req);
    if (!config.ok) {
      return config;
    }
    const runtime = runtimeFor(config.value);
    if (!runtime.ok) {
      return runtime;
    }

    const version = assertClientContractVersion(
      req.get('x-coderax-contract-version') ?? undefined,
      requestId(req) ?? '',
    );
    if (!version.ok) {
      return version;
    }

    const snapshot = await runtime.value.negotiation.snapshot({
      force: queryString(req.query.refresh) === '1',
    });
    if (!snapshot.ok) {
      return snapshot;
    }

    const declared = parseCapabilityHeader(req.get('x-coderax-required-capabilities') ?? undefined);
    const capabilities = assertRequiredCapabilities(
      declared,
      snapshot.value.capabilities,
      requestId(req) ?? '',
    );
    if (!capabilities.ok) {
      return capabilities;
    }

    const missing = required.filter((capability) => !snapshot.value.capabilities[capability]);
    if (missing.length > 0) {
      return fail(
        gatewayError('capability_unavailable', {
          detail: `the WorkflowEngine does not offer: ${missing.join(', ')}`,
          ...(requestId(req) ? { requestId: requestId(req) } : {}),
          retryable: true,
        }),
      );
    }

    return ok({ service: runtime.value.service, config: config.value });
  }

  function requireOwner(req: Request, res: Response, next: NextFunction): void {
    const user = (req as Request & { user?: unknown }).user;
    if (user == null) {
      sendFailure(
        res,
        gatewayError('unauthorized', { detail: 'authentication is required', retryable: false }),
      );
      return;
    }
    if (!deps.isOwner(user)) {
      sendFailure(
        res,
        gatewayError('forbidden', {
          detail: 'the WorkflowEngine gateway is available to the owner only',
          retryable: false,
        }),
      );
      return;
    }
    next();
  }

  async function json(
    req: Request,
    res: Response,
    action: (context: {
      service: GatewayService;
      config: GatewayConfig;
    }) => Promise<GatewayResult<unknown>>,
    options: { status?: number; required?: readonly GatewayCapability[] } = {},
  ): Promise<void> {
    setGatewayHeaders(res);
    const context = await enter(req, options.required ?? []);
    if (!context.ok) {
      sendFailure(res, context.error);
      return;
    }
    let result: GatewayResult<unknown>;
    try {
      result = await action({ service: context.value.service, config: context.value.config });
    } catch (error) {
      deps.logger?.error?.('[gateway] handler failed', {
        kind: error instanceof Error ? error.name : 'UnknownError',
      });
      sendFailure(res, gatewayError('internal_error'));
      return;
    }
    if (!result.ok) {
      sendFailure(res, result.error);
      return;
    }
    res.status(options.status ?? 200).json(result.value);
  }

  return {
    requireOwner,

    meta: async (req, res) => {
      setGatewayHeaders(res);
      const config = resolveConfig(req);
      if (!config.ok) {
        sendFailure(res, config.error);
        return;
      }
      const runtime = runtimeFor(config.value);
      if (!runtime.ok) {
        sendFailure(res, runtime.error);
        return;
      }
      const result = await runtime.value.service.meta();
      if (!result.ok) {
        sendFailure(res, result.error);
        return;
      }
      res.status(200).json(result.value);
    },

    health: (req, res) => json(req, res, ({ service }) => service.health()),
    readiness: (req, res) => json(req, res, ({ service }) => service.readiness()),
    agents: (req, res) => json(req, res, ({ service }) => service.agents()),
    models: (req, res) => json(req, res, ({ service }) => service.models()),

    chat: async (req, res) => {
      setGatewayHeaders(res);
      const context = await enter(req, ['chat']);
      if (!context.ok) {
        sendFailure(res, context.error);
        return;
      }
      const result = await context.value.service.chat(req.body);
      if (!result.ok) {
        sendFailure(res, result.error);
        return;
      }
      if (requestId(req) != null) {
        res.setHeader('x-request-id', requestId(req) as string);
      }
      if (!acceptsSse(req)) {
        res.status(200).json(result.value.reply);
        return;
      }
      // Contract 1.0.0 declares `submitChat` streamable, but its published
      // success shape is one `ChatReply`. The gateway frames that validated
      // reply as SSE for browsers and never invents unvalidated delta frames.
      beginSse(res);
      writeFrame(res, result.value.reply);
      res.end();
    },

    submitWork: async (req, res) => {
      setGatewayHeaders(res);
      const wantsStream = acceptsSse(req);
      const context = await enter(req, wantsStream ? ['work', 'events'] : ['work']);
      if (!context.ok) {
        sendFailure(res, context.error);
        return;
      }
      const submitted = await context.value.service.submitWork(req.body);
      if (!submitted.ok) {
        sendFailure(res, submitted.error);
        return;
      }
      if (!wantsStream) {
        res.status(202).json(submitted.value);
        return;
      }

      const task: TaskAccepted = submitted.value;
      const controller = new AbortController();
      res.on('close', () => controller.abort());
      beginSse(res);
      writeFrame(res, { type: 'accepted', task });
      const stream = await context.value.service.events(task.taskId, 0, {
        signal: controller.signal,
      });
      if (!stream.ok) {
        res.end();
        return;
      }
      const heartbeat = setInterval(() => {
        if (!res.writableEnded && !res.destroyed) {
          res.write(': ping\n\n');
        }
      }, HEARTBEAT_MS);
      heartbeat.unref?.();
      try {
        for await (const event of stream.value.events) {
          if (!writeFrame(res, { type: 'event', event }, event.seq)) {
            break;
          }
        }
      } catch {
        // Fail closed: a contract violation or upstream failure closes the
        // stream. The client resumes from its cursor instead of receiving an
        // unvalidated frame.
      } finally {
        clearInterval(heartbeat);
        if (!res.writableEnded) {
          res.end();
        }
      }
    },

    getTask: (req, res) => json(req, res, ({ service }) => service.task(req.params.taskId ?? '')),

    artifacts: (req, res) =>
      json(req, res, ({ service }) => service.artifacts(req.params.taskId ?? '')),

    cancel: (req, res) =>
      json(req, res, ({ service }) => service.cancel(req.params.taskId ?? '', req.body)),

    resume: (req, res) =>
      json(req, res, ({ service }) => service.resume(req.params.taskId ?? '', req.body)),

    retry: (req, res) =>
      json(req, res, ({ service }) => service.retry(req.params.taskId ?? '', req.body)),

    events: async (req, res) => {
      setGatewayHeaders(res);
      const context = await enter(req, ['events']);
      if (!context.ok) {
        sendFailure(res, context.error);
        return;
      }
      const after = parseAfter(req);
      if (!after.ok) {
        sendFailure(res, after.error);
        return;
      }

      const controller = new AbortController();
      res.on('close', () => controller.abort());
      const stream = await context.value.service.events(req.params.taskId ?? '', after.value, {
        signal: controller.signal,
      });
      if (!stream.ok) {
        sendFailure(res, stream.error);
        return;
      }

      beginSse(res);
      res.write(`retry: 3000\n\n`);
      const heartbeat = setInterval(() => {
        if (!res.writableEnded && !res.destroyed) {
          res.write(': ping\n\n');
        }
      }, HEARTBEAT_MS);
      heartbeat.unref?.();
      try {
        for await (const event of stream.value.events) {
          if (!writeFrame(res, event, event.seq)) {
            break;
          }
        }
      } catch {
        // See submitWork: an invalid or failed stream ends; the client resyncs.
      } finally {
        clearInterval(heartbeat);
        if (!res.writableEnded) {
          res.end();
        }
      }
    },

    conversations: (req, res) => json(req, res, ({ service }) => service.conversations()),

    conversation: (req, res) =>
      json(req, res, ({ service }) => service.conversation(req.params.conversationId ?? '')),

    memory: (req, res) =>
      json(req, res, ({ service }) =>
        service.memory(queryString(req.query.mode) === 'cloud' ? 'cloud' : 'private'),
      ),

    permissions: (req, res) =>
      json(req, res, ({ service }) => service.permissions(req.params.taskId ?? '')),

    decidePermission: (req, res) =>
      json(req, res, ({ service }) => service.decidePermission(req.params.taskId ?? '', req.body)),

    notifications: (req, res) => json(req, res, ({ service }) => service.notifications()),

    scheduling: async (req, res) => {
      setGatewayHeaders(res);
      const config = resolveConfig(req);
      if (!config.ok) {
        sendFailure(res, config.error);
        return;
      }
      const runtime = runtimeFor(config.value);
      if (!runtime.ok) {
        sendFailure(res, runtime.error);
        return;
      }
      const result = runtime.value.service.scheduling();
      if (!result.ok) {
        sendFailure(res, result.error);
        return;
      }
      res.status(200).json(result.value);
    },
  };
}

export function emitEventFrame(res: Response, event: ExecutionEvent): boolean {
  return writeFrame(res, event, event.seq);
}
