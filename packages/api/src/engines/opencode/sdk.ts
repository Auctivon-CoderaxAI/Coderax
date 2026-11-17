import type { EngineResult } from '../types';
import type { OpenCodeTransport } from './adapter';
import { engineFailure } from '../types';

/**
 * Official OpenCode SDK loader.
 *
 * `@opencode-ai/sdk` is ESM-only while `@coderax/api` compiles to CommonJS.
 * Node's `require(esm)` support makes a direct require work on Node >= 22.12;
 * older runtimes receive a typed `sdk_unavailable` failure instead of a crash.
 * The SDK is loaded lazily and only when this adapter is enabled, so an unused
 * engine never starts a server or adds startup cost.
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
  createOpencodeClient: (config: { baseUrl?: string; directory?: string }) => unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
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
}): EngineResult<LoadedOpenCodeSdk> {
  let loaded: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require('@opencode-ai/sdk');
  } catch {
    return engineFailure(
      'sdk_unavailable',
      'Install @opencode-ai/sdk on Node 22.12 or newer to enable this engine.',
    );
  }
  if (!isRecord(loaded) || typeof loaded.createOpencodeClient !== 'function') {
    return engineFailure('sdk_unavailable', 'The installed OpenCode SDK has an unsupported shape.');
  }

  const createClient = loaded.createOpencodeClient;
  const client = createClient({ baseUrl: options.baseURL, directory: options.directory });
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
      return response.stream as AsyncIterable<unknown>;
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
