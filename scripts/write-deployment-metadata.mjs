#!/usr/bin/env node
/**
 * Writes the revision the deployed Worker is serving beside the built SPA.
 *
 * Cloudflare Workers Builds injects WORKERS_CI_COMMIT_SHA and WORKERS_CI_BRANCH;
 * other build environments fall back to GitHub/Vercel variables and then to git.
 * The file is a public, non-secret build artifact and is the only evidence that
 * a live origin serves a particular commit, so a missing SHA is written as null
 * and the release gate fails rather than reporting an unidentified deployment.
 *
 * Usage:
 *   node scripts/write-deployment-metadata.mjs
 *   node scripts/write-deployment-metadata.mjs --output <file> --commit <sha> --branch <name>
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function option(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} needs a value`);
  }
  return value;
}

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function first(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return '';
}

const commit = first(
  option('--commit'),
  process.env.WORKERS_CI_COMMIT_SHA,
  process.env.GITHUB_SHA,
  process.env.VERCEL_GIT_COMMIT_SHA,
  git('rev-parse', 'HEAD'),
).toLowerCase();
const verifiableCommit = /^[0-9a-f]{40}$/.test(commit) ? commit : null;
const branch =
  first(
    option('--branch'),
    process.env.WORKERS_CI_BRANCH,
    process.env.GITHUB_REF_NAME,
    process.env.VERCEL_GIT_COMMIT_REF,
    git('rev-parse', '--abbrev-ref', 'HEAD'),
  ) || 'unknown';
const worker = option('--worker') ?? 'coderax';
const output = path.resolve(root, option('--output') ?? 'client/dist/deployment.json');

mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(
  output,
  `${JSON.stringify(
    {
      worker,
      commit: verifiableCommit,
      branch,
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);

if (verifiableCommit === null) {
  console.warn(
    `No 40-character commit was available; wrote ${output} without a verifiable revision.`,
  );
} else {
  console.log(`Wrote ${output} for ${verifiableCommit} on ${branch}.`);
}
