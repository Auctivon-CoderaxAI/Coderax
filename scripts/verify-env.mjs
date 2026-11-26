#!/usr/bin/env node
/**
 * Validate the centralized environment contract without reading secret values.
 *
 * Checks:
 *   - env.lock.json is well formed and every provider credential is declared.
 *   - Every name is a POSIX shell identifier; a leading digit is rejected.
 *   - .env.example documents every canonical variable.
 *   - No provider secret name is referenced from client source.
 *   - Presence is reported as configured/missing; values are never printed.
 *
 * Usage:
 *   node scripts/verify-env.mjs [--json] [--require-provider=<id>]
 *
 * Exit codes: 0 = contract valid (missing optional credentials allowed),
 * 1 = a contract violation or a required provider credential is missing.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const requireProvider = args
  .find((arg) => arg.startsWith('--require-provider='))
  ?.slice('--require-provider='.length);

const errors = [];
const warnings = [];

function readJson(file) {
  try {
    return JSON.parse(readFileSync(join(root, file), 'utf8'));
  } catch (error) {
    console.error(`Could not read ${file}: ${error.message}`);
    process.exit(2);
  }
}

const envLock = readJson('env.lock.json');
const providerLock = readJson('providers.lock.json');
const examplePath = join(root, '.env.example');
const example = existsSync(examplePath) ? readFileSync(examplePath, 'utf8') : '';

if (!Array.isArray(envLock.variables) || envLock.variables.length === 0) {
  errors.push('env.lock.json must declare a non-empty variables array');
}
if (!Array.isArray(providerLock.providers) || providerLock.providers.length === 0) {
  errors.push('providers.lock.json must declare a non-empty providers array');
}

const providerIds = new Set((providerLock.providers ?? []).map((provider) => provider.id));
const variables = Array.isArray(envLock.variables) ? envLock.variables : [];
const byName = new Map();
const NAME = /^[A-Z_][A-Z0-9_]*$/;

for (const variable of variables) {
  if (!NAME.test(variable.name ?? '')) {
    errors.push(`Invalid environment name "${variable.name}": must match ${NAME}`);
  }
  if (byName.has(variable.name)) {
    errors.push(`Duplicate environment variable "${variable.name}"`);
  }
  byName.set(variable.name, variable);

  if (!providerIds.has(variable.provider)) {
    errors.push(`"${variable.name}" names unknown provider "${variable.provider}"`);
  }
  if (variable.secret === true && variable.scope !== 'server') {
    errors.push(`Secret "${variable.name}" must be scoped to the server`);
  }
  if (variable.clientVisible === true) {
    errors.push(`Secret "${variable.name}" must not be client-visible`);
  }
  if (!example.match(new RegExp(`(?:^|\\n)#?\\s*${variable.name}\\b`))) {
    errors.push(`"${variable.name}" is not documented in .env.example`);
  }

  for (const legacy of variable.legacyNames ?? []) {
    if (NAME.test(legacy) === false) {
      warnings.push(
        `Legacy name "${legacy}" is not a POSIX shell identifier; only a non-shell environment can inject it.`,
      );
    }
  }
}

for (const provider of providerLock.providers ?? []) {
  const credentialEnv = provider.auth?.credentialEnv;
  if (!credentialEnv || !byName.has(credentialEnv)) {
    errors.push(`Provider "${provider.id}" has no declared credential in env.lock.json`);
    continue;
  }
  if (byName.get(credentialEnv).provider !== provider.id) {
    errors.push(
      `Provider "${provider.id}" points at "${credentialEnv}", which env.lock.json assigns to "${byName.get(credentialEnv).provider}"`,
    );
  }
  for (const required of provider.auth?.requiredEnv ?? []) {
    if (!byName.has(required)) {
      errors.push(`Provider "${provider.id}" requires undeclared "${required}"`);
    }
  }
}

function sourceFiles(dir, files = []) {
  if (!existsSync(dir)) {
    return files;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(path, files);
    } else if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

const secretNames = variables
  .filter((variable) => variable.secret === true)
  .flatMap((variable) => [variable.name, ...(variable.legacyNames ?? [])]);
const clientFiles = [
  ...sourceFiles(join(root, 'client', 'src')),
  ...sourceFiles(join(root, 'packages', 'client', 'src')),
];

// A name in a fixture is harmless; an actual client-side environment read is not.
for (const file of clientFiles) {
  const text = readFileSync(file, 'utf8');
  for (const name of secretNames) {
    const reads = [
      `process.env.${name}`,
      `process.env['${name}']`,
      `process.env["${name}"]`,
      `import.meta.env.${name}`,
      `VITE_${name}`,
      `NEXT_PUBLIC_${name}`,
    ];
    if (reads.some((read) => text.includes(read))) {
      errors.push(
        `${relative(root, file)} reads server secret "${name}" from client code; secrets must not reach the client bundle`,
      );
    }
  }
}

const presence = variables.map((variable) => {
  const names = [variable.name, ...(variable.legacyNames ?? [])];
  return {
    name: variable.name,
    provider: variable.provider,
    scope: variable.scope,
    secret: variable.secret === true,
    configured: names.some((name) => Boolean(process.env[name])),
  };
});

if (requireProvider) {
  const matches = presence.filter((entry) => entry.provider === requireProvider);
  if (matches.length === 0) {
    errors.push(`No environment variables are declared for provider "${requireProvider}"`);
  } else if (!matches.some((entry) => entry.configured)) {
    errors.push(`Provider "${requireProvider}" has no configured credential`);
  }
}

const summary = {
  checkedAt: new Date().toISOString(),
  providers: providerLock.providers?.length ?? 0,
  variables: variables.length,
  configured: presence.filter((entry) => entry.configured).length,
  missing: presence.filter((entry) => !entry.configured).length,
  errors,
  warnings,
  variablesPresence: presence,
};

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log('Provider environment audit (names only; no values are read or printed)');
  for (const entry of presence) {
    console.log(
      `  ${entry.configured ? 'configured' : 'missing   '}  ${entry.name}  [${entry.provider}]`,
    );
  }
  console.log(
    `\n${summary.configured}/${summary.variables} variables configured, ${errors.length} error(s), ${warnings.length} warning(s)`,
  );
  for (const warning of warnings) {
    console.warn(`warning: ${warning}`);
  }
  for (const error of errors) {
    console.error(`error: ${error}`);
  }
}

process.exit(errors.length > 0 ? 1 : 0);
