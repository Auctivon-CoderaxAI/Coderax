import path from 'node:path';
import { defineConfig } from 'tsdown';

// Vercel's function tracer omitted multiple @coderax/api production dependencies.
// Bundle the production dependency set instead of fixing missing modules one by one.
// In addition to WebAuthn and MCP, the healthy-build preview crashed on helmet.
// Include the WebAuthn dependency graph, not just @simplewebauthn/server:
// the original preview next failed to load @hexagon/base64.
// Some dependencies of the MCP SDK are dynamically imported by its transports.
// Vercel's function tracing omitted these modules even though npm ci installed
// them: keep them in the emitted API bundle alongside the SDK itself.
const mcpRuntimeModules = /^(?:@modelcontextprotocol\/sdk|@langchain\/langgraph-checkpoint(?:-mongodb)?|@simplewebauthn\/server|@hexagon\/base64|@levischuck\/tiny-cbor|@peculiar\/[^/]+|reflect-metadata|eventsource(?:-parser)?|jose|pkce-challenge|ajv(?:-formats)?|json-schema-typed|zod-to-json-schema|hono|@hono\/node-server|cluster-key-slot|croner|express-rate-limit|helmet|mathjs|ollama|proxy-from-env|rate-limit-redis|re2js|asn1js|pvtsutils|pvutils|tslib|tsyringe)(?:\/|$)/;

export default defineConfig({
  // The telemetry entry is a thin shim (`src/telemetry.ts`) rather than the
  // `src/telemetry/index.ts` barrel: oxc emits declarations flat into outDir keyed
  // by source basename, so two `index.ts` entries would collide (index.d.cts +
  // index2.d.cts). Distinct basenames yield stable `index.*` / `telemetry.*` output.
  entry: [
    'src/index.ts',
    'src/telemetry.ts',
    'src/credentials.ts',
    'src/agents/files/edit-worker.ts',
  ],
  format: ['cjs'],
  platform: 'node',
  dts: { oxc: true },
  outDir: 'dist',
  sourcemap: true,
  // Warn on module cycles at build time; CI enforces via config/circular-deps.mjs.
  checks: { circularDependency: true },
  // Externalize every third-party dependency (consumers provide the peers) and bundle
  // only first-party code: relative imports and the `~/*` tsconfig alias (-> src).
  // `neverBundle` is the 0.22 replacement for the deprecated `external` option.
  deps: {
    neverBundle: (id) => id !== 'mathjs' && !mcpRuntimeModules.test(id) && !id.startsWith('.') && !id.startsWith('~') && !path.isAbsolute(id),
    // Vercel Services traces this workspace as a function. The calculator and
    // MCP SDK, plus its SDK-specific transport/auth dependencies, must be in the
    // emitted API bundle. Vercel's function tracer omitted these at runtime.
    alwaysBundle: ['mathjs', mcpRuntimeModules],
  },
});
