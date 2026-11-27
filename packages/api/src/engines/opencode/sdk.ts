import fs from 'node:fs';
import path from 'node:path';
import type { OpenCodeTransport } from './adapter';
import type { EngineResult } from '../types';
import { openCodeAuthHeader } from './auth';
import { engineFailure } from '../types';

/**
 * Official OpenCode SDK loader.
 *
 * `@opencode-ai/sdk` is ESM-only while `@coderax/api` compiles to CommonJS,
 * and 1.19.6 publishes only an `import` export condition. A bare `require`
 * therefore fails with ERR_PACKAGE_PATH_NOT_EXPORTED even on a runtime that
 * can load ESM. The loader falls back to the pinned `dist/index.js` entry so
 * the engine works on Node, while an unsupported runtime still receives a
 * typed `sdk_unavailable` failure instead of a crash. The SDK is loaded lazily
 * and only when this adapter is enabled, so an unused engine adds no startup
 * cost.
 */

type SdkRequestResult = { data?: unknown; error?: unknown };

type SdkClient = {
  session: {
    create: (input: {
      body: { title?: string };
      query?: { directory?: string };
    }) => Promise<SdkRequestResult>;
    promptAsync: (input: {
      path: { id: string };
      body: {
        model?: { providerID: string; modelID: string };
        parts: Array<{ type: 'text'; text: string }>;
      };
      query?: { directory?: string };
    }) => Promise<unknown>;
    abort: (input: { path: { id: string }; query?: { directory?: string } }) => Promise<unknown>;
  };
  event: {
    subscribe: (input?: {
      query?: { directory?: string };
      signal?: AbortSignal;
    }) => Promise<{ stream: AsyncIterable<unknown> }>;
  };
};

type SdkModule = {
  createOpencodeClient: (config: {
    baseUrl?: string;
    directory?: string;
    headers?: Record<string, string>;
  }) => unknown;
};

/** Locate the pinned ESM entry without relying on the missing require condition. */
export function resolveOpenCodeSdkEntry(): string | null {
  for (const root of require.resolve.paths('@opencode-ai/sdk') ?? []) {
    const candidate = path.join(root, '@opencode-ai', 'sdk', 'dist', 'index.js');
    try {
      if (fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Keep looking in the next node_modules directory.
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isServerConnected(value: unknown): boolean {
  return isRecord(value) && value.type === 'server.connected';
}

export type LoadedOpenCodeSdk = {
  module: SdkModule;
  transport: OpenCodeTransport;
};

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Build a transport bound to an existing OpenCode server. Coderax does not
 * spawn a server here: attaching to an operator-run `opencode serve` keeps the
 * API process' memory flat on small Always Free ARM64 instances.
 */
export function loadOpenCodeSdk(options: {
  baseURL: string;
  directory: string;
  username?: string;
  password?: string;
}): EngineResult<LoadedOpenCodeSdk> {
  let loaded: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require('@opencode-ai/sdk');
  } catch (error) {
    /**
     * 1.19.6 declares only an `import` export condition, so a bare `require`
     * fails on Node with ERR_PACKAGE_PATH_NOT_EXPORTED even though the runtime
     * supports loading the ESM entry. Load the pinned entry file directly, but
     * only after locating it inside a real node_modules directory.
     */
    const code = (error as NodeJS.ErrnoException).code;
    const entry = code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' ? resolveOpenCodeSdkEntry() : null;
    if (!entry) {
      return engineFailure(
        'sdk_unavailable',
        'The installed OpenCode SDK could not be loaded on this Node runtime.',
      );
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      loaded = require(entry);
    } catch {
      return engineFailure(
        'sdk_unavailable',
        'The installed OpenCode SDK could not be loaded on this Node runtime.',
      );
    }
  }
  if (!isRecord(loaded) || typeof loaded.createOpencodeClient !== 'function') {
    return engineFailure('sdk_unavailable', 'The installed OpenCode SDK has an unsupported shape.');
  }

  const createClient = loaded.createOpencodeClient;
  const headers = openCodeAuthHeader({
    ...(options.username ? { username: options.username } : {}),
    ...(options.password ? { password: options.password } : {}),
  });
  const client = createClient({
    baseUrl: options.baseURL,
    directory: options.directory,
    ...(headers ? { headers } : {}),
  });
  const sdk = client as SdkClient;
  if (
    !isRecord(sdk) ||
    !isRecord(sdk.session) ||
    typeof sdk.session.create !== 'function' ||
    typeof sdk.session.promptAsync !== 'function' ||
    typeof sdk.session.abort !== 'function' ||
    !isRecord(sdk.event) ||
    typeof sdk.event.subscribe !== 'function'
  ) {
    return engineFailure('sdk_unavailable', 'The installed OpenCode SDK is missing required APIs.');
  }

  const transport: OpenCodeTransport = {
    createSession: async (input) => {
      const response = await sdk.session.create({
        body: { ...(input.title ? { title: input.title } : {}) },
        query: { directory: input.directory },
      });
      const data = isRecord(response.data) ? response.data : null;
      const id = requiredString(data?.id);
      if (!id) {
        throw new Error('OpenCode returned no session id');
      }
      return { id };
    },
    subscribe: async (input) => {
      const response = await sdk.event.subscribe({
        query: { directory: input.directory },
        ...(input.signal ? { signal: input.signal } : {}),
      });
      if (!isRecord(response) || !response.stream) {
        throw new Error('OpenCode returned no event stream');
      }
      const iterator = (response.stream as AsyncIterable<unknown>)[Symbol.asyncIterator]();
      const buffered: unknown[] = [];
      for (;;) {
        const next = await iterator.next();
        if (next.done) {
          throw new Error('OpenCode event stream closed before it was ready');
        }
        buffered.push(next.value);
        if (isServerConnected(next.value)) {
          break;
        }
      }
      return (async function* () {
        try {
          for (const event of buffered) {
            yield event;
          }
          for (;;) {
            const next = await iterator.next();
            if (next.done) {
              return;
            }
            yield next.value;
          }
        } finally {
          await iterator.return?.();
        }
      })();
    },
    prompt: async (input) => {
      const result = (await sdk.session.promptAsync({
        path: { id: input.sessionId },
        query: { directory: input.directory },
        body: {
          ...(input.model
            ? { model: { providerID: input.model.providerId, modelID: input.model.modelId } }
            : {}),
          parts: [{ type: 'text', text: input.text }],
        },
      })) as SdkRequestResult | undefined;
      if (isRecord(result) && result.error) {
        throw new Error('OpenCode rejected the prompt');
      }
    },
    abort: async (input) => {
      await sdk.session.abort({
        path: { id: input.sessionId },
        query: { directory: input.directory },
      });
    },
  };

  return { ok: true, value: { module: loaded as SdkModule, transport } };
}
