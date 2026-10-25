import path from 'node:path';
import { defineConfig } from 'tsdown';

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
    neverBundle: (id) => id !== 'mathjs' && !id.startsWith('@modelcontextprotocol/sdk') && !id.startsWith('.') && !id.startsWith('~') && !path.isAbsolute(id),
    // Vercel Services traces this workspace as a function. The calculator and
    // MCP SDK (including its /types.js subpath) must be in the emitted API
    // bundle: both have been missing from deployed function traces.
    alwaysBundle: ['mathjs', /^@modelcontextprotocol\/sdk(?:\/|$)/],
  },
});
