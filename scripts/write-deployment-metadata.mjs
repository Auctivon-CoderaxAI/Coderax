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
 *   node scripts/write-deployment-metadata.mjs --verify
 *   node scripts/write-deployment-metadata.mjs --output <file> --commit <sha> --branch <name>
 *
 * --verify refuses to deploy when the marker is missing or names a commit other
 * than the current checkout, so a manual deploy cannot claim a revision its
 * assets were not built from.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const verify = process.argv.includes('--verify');

if (verify) {
  if (verifiableCommit === null) {
    throw new Error('Cannot verify deployment provenance without a full 40-character commit.');
  }
  let existing;
  try {
    existing = JSON.parse(readFileSync(output, 'utf8'));
  } catch {
    throw new Error(
      `No readable deployment marker at ${output}; build the assets before deploying.`,
    );
  }
  if (!/^[0-9a-f]{40}$/.test(existing.commit ?? '')) {
    throw new Error(`${output} has no full commit; refusing to deploy unidentified assets.`);
  }
  if (existing.commit.toLowerCase() !== verifiableCommit) {
    throw new Error(
      `${output} was built for ${existing.commit}, but the current commit is ${verifiableCommit}; rebuild before deploying.`,
    );
  }
  console.log(`Verified ${output} for ${existing.commit} on ${existing.branch ?? 'unknown'}.`);
} else {
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
}
