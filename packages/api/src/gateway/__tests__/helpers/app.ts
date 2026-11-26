import express from 'express';
import type { Express, NextFunction, Request, Response as ExpressResponse } from 'express';
import type { AddressInfo } from 'node:net';
import type { GatewayHandlerDeps } from '../../handlers';
import { createGatewayHandlers } from '../../handlers';
import { isOwnerUser } from '../../owner';

/**
 * Mirrors `api/server/routes/gateway.js` so the integration test exercises the
 * same handler set and mount order over a real TCP listener. Authentication is
 * injected the way `requireJwtAuth` populates `req.user` in production.
 */
export type TestAppOptions = {
  user?: unknown;
  gateway: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
  deps?: Partial<GatewayHandlerDeps>;
};

export type RunningApp = {
  url: string;
  close: () => Promise<void>;
};

export function createGatewayTestApp(options: TestAppOptions): Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req: Request, _res: ExpressResponse, next: NextFunction) => {
    const target = req as unknown as { user?: unknown; config?: unknown };
    target.user = options.user;
    target.config = { gateway: options.gateway };
    next();
  });

  const handlers = createGatewayHandlers({
    env: options.env ?? {},
    isOwner: isOwnerUser,
    ...options.deps,
  });

  app.use(handlers.requireOwner);

  app.get('/meta', handlers.meta);
  app.get('/v1/health', handlers.health);
  app.get('/v1/ready', handlers.readiness);
  app.get('/v1/agents', handlers.agents);
  app.get('/v1/models', handlers.models);
  app.post('/v1/chat', handlers.chat);
  app.post('/v1/work', handlers.submitWork);
  app.get('/v1/work/:taskId', handlers.getTask);
  app.get('/v1/work/:taskId/artifacts', handlers.artifacts);
  app.get('/v1/work/:taskId/events', handlers.events);
  app.post('/v1/work/:taskId/cancel', handlers.cancel);
  app.post('/v1/work/:taskId/resume', handlers.resume);
  app.post('/v1/work/:taskId/retry', handlers.retry);
  app.get('/v1/work/:taskId/permissions', handlers.permissions);
  app.post('/v1/work/:taskId/permissions', handlers.decidePermission);
  app.get('/v1/conversations', handlers.conversations);
  app.get('/v1/conversations/:conversationId', handlers.conversation);
  app.get('/v1/memory', handlers.memory);
  app.get('/v1/notifications', handlers.notifications);
  app.get('/v1/schedules', handlers.scheduling);

  app.use((error: unknown, _req: Request, res: ExpressResponse, _next: NextFunction) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(500).json({
      type: 'https://coderax.dev/problems/internal_error',
      title: 'internal error',
      status: 500,
      code: 'internal_error',
      retryable: false,
      detail: error instanceof Error ? error.name : 'UnknownError',
    });
  });

  return app;
}

export async function listen(app: Express): Promise<RunningApp> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/** Reads SSE `data:` frames from a real response body. */
export async function readSseFrames(response: globalThis.Response): Promise<unknown[]> {
  const text = await response.text();
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.includes('data:'))
    .map((block) => {
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      return JSON.parse(data) as unknown;
    });
}
