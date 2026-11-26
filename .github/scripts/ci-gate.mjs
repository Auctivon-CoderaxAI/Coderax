#!/usr/bin/env node
/**
 * Aggregate CI gate.
 *
 * Component workflows in this repository are path-filtered, so on any given pull
 * request most of them never create a check run. A required status check that
 * names one of those workflows is therefore permanently pending on every pull
 * request the filter does not apply to, which disables the merge button for a
 * reason unrelated to the change.
 *
 * This script backs the single required check instead. Its workflow has no path
 * filter, so the check always reports. It then decides which component
 * workflows the diff applies to, waits for those to reach a conclusion at the
 * pull request's exact head SHA, and fails when one of them failed, was
 * cancelled, or never reported at all.
 *
 * The expected set comes from each component workflow's own
 * `on.pull_request.paths` and `on.pull_request.branches` block, so a filter is
 * declared once, in the workflow that owns it. A workflow that started anyway is
 * waited on as well, so a disagreement between this parser and GitHub's own
 * filter fails toward waiting rather than toward an early green.
 */

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PASSING_CONCLUSIONS = new Set(['success', 'skipped', 'neutral']);

/**
 * Workflows whose runs are telemetry rather than merge gates. They still run and
 * still report, but their conclusion does not decide whether the change merges.
 * Keep this list short and justified: anything that a merge must depend on
 * belongs outside it.
 */
export const ADVISORY_WORKFLOW_NAMES = new Set([
  // Records which tests a change would have selected. Observational only.
  'Codegraph Select (observe)',
]);

/**
 * Escapes a single character for use inside a regular expression.
 *
 * @param {string} character
 * @returns {string}
 */
function escapeRegExp(character) {
  return /[.*+?^${}()|[\]\\]/.test(character) ? `\\${character}` : character;
}

/**
 * Translates one GitHub path-filter glob into a regular expression anchored to
 * the whole path.
 *
 * Supported syntax is the subset the repository's workflows actually use:
 * `**` for any number of path segments, `*` and `?` within a segment, and a
 * leading `!` handled by the caller rather than here.
 *
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === '*') {
      const isDoubleStar = glob[index + 1] === '*';
      if (isDoubleStar) {
        // `**/` may stand for no directory at all, so `**/x` matches `x`.
        if (glob[index + 2] === '/') {
          source += '(?:.*/)?';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (character === '?') {
      source += '[^/]';
      continue;
    }
    source += escapeRegExp(character);
  }
  return new RegExp(`^${source}$`);
}

/**
 * Applies one `paths`/`branches` filter list to a set of changed paths.
 *
 * GitHub's semantics: a path passes when it matches at least one positive
 * pattern and no `!`-prefixed negative pattern, and the filter as a whole
 * matches when at least one changed path passes. A list holding only negative
 * patterns means "everything except these".
 *
 * @param {string[] | null} patterns
 * @param {string[]} candidates
 * @returns {boolean}
 */
export function matchesFilter(patterns, candidates) {
  if (!patterns || patterns.length === 0) {
    return true;
  }
  const positives = patterns.filter((pattern) => !pattern.startsWith('!'));
  const negatives = patterns
    .filter((pattern) => pattern.startsWith('!'))
    .map((pattern) => globToRegExp(pattern.slice(1)));
  const positiveMatchers = positives.map(globToRegExp);

  return candidates.some((candidate) => {
    const allowed =
      positiveMatchers.length === 0 || positiveMatchers.some((matcher) => matcher.test(candidate));
    if (!allowed) {
      return false;
    }
    return !negatives.some((matcher) => matcher.test(candidate));
  });
}

/**
 * Reads a `key: [a, b]` / `key: value` / block-list value starting at `index`.
 *
 * @param {string[]} lines
 * @param {number} index line holding the key
 * @param {number} indent indentation of the key
 * @returns {{ values: string[] | null, nextIndex: number }}
 */
function readValue(lines, index, indent) {
  const raw = lines[index];
  const inline = raw.slice(indent).replace(/^[^:]+:\s*/, '').trim();
  if (inline.startsWith('[') && inline.endsWith(']')) {
    const values = inline
      .slice(1, -1)
      .split(',')
      .map((value) => value.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    return { values, nextIndex: index + 1 };
  }
  if (inline.length > 0 && !inline.startsWith('#')) {
    return { values: [inline.replace(/^['"]|['"]$/g, '')], nextIndex: index + 1 };
  }

  const values = [];
  let cursor = index + 1;
  const itemIndent = indent + 2;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.trim().length === 0) {
      cursor += 1;
      continue;
    }
    const lineIndent = line.length - line.trimStart().length;
    const isItem = line.trimStart().startsWith('- ');
    if (lineIndent !== itemIndent || !isItem) {
      break;
    }
    const value = line.trimStart().slice(2).trim().replace(/^['"]|['"]$/g, '');
    if (value.length > 0 && !value.startsWith('#')) {
      values.push(value);
    }
    cursor += 1;
  }
  return { values: values.length > 0 ? values : null, nextIndex: cursor };
}

/**
 * Extracts the workflow name and its `pull_request` trigger filter.
 *
 * Returns `{ name, path, pullRequest }` where `pullRequest` is `null` when the
 * workflow does not run on `pull_request`, and otherwise
 * `{ paths, branches, types }` with `null` for a filter the workflow omits.
 *
 * @param {string} source workflow file contents
 * @param {string} workflowPath repository-relative path
 * @returns {{ name: string, path: string, pullRequest: { paths: string[] | null, branches: string[] | null, types: string[] | null } | null }}
 */
export function parseWorkflow(source, workflowPath) {
  const lines = source.split(/\r?\n/);

  let name = workflowPath;
  const nameIndex = lines.findIndex((line) => /^name:\s*/.test(line));
  if (nameIndex !== -1) {
    name = lines[nameIndex].replace(/^name:\s*/, '').trim().replace(/^['"]|['"]$/g, '');
  }

  const onIndex = lines.findIndex((line) => /^on:/.test(line));
  if (onIndex === -1) {
    return { name, path: workflowPath, pullRequest: null };
  }

  // `on: pull_request` as a bare scalar, or `on: [push, pull_request]`.
  const inlineTriggers = lines[onIndex].replace(/^on:\s*/, '').trim();
  if (inlineTriggers.length > 0 && !inlineTriggers.startsWith('#')) {
    const triggers = inlineTriggers
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((value) => value.trim());
    return {
      name,
      path: workflowPath,
      pullRequest: triggers.includes('pull_request')
        ? { paths: null, branches: null, types: null }
        : null,
    };
  }

  let triggerCount = 0;
  let pullRequestIndex = -1;
  for (let index = onIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) {
      continue;
    }
    if (!/^\s/.test(line)) {
      break;
    }
    const lineIndent = line.length - line.trimStart().length;
    if (lineIndent === 2) {
      triggerCount += 1;
      if (line.trim() === 'pull_request:') {
        pullRequestIndex = index;
      }
    }
  }
  if (triggerCount === 0 || pullRequestIndex === -1) {
    return { name, path: workflowPath, pullRequest: null };
  }

  const filters = { paths: null, branches: null, types: null };
  for (let index = pullRequestIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) {
      continue;
    }
    if (!/^\s/.test(line)) {
      break;
    }
    const lineIndent = line.length - line.trimStart().length;
    if (lineIndent <= 2) {
      break;
    }
    const keyMatch = line.trimStart().match(/^(paths|branches|types):/);
    if (!keyMatch) {
      continue;
    }
    const { values, nextIndex } = readValue(lines, index, lineIndent);
    filters[keyMatch[1]] = values;
    index = nextIndex - 1;
  }

  return { name, path: workflowPath, pullRequest: filters };
}

/**
 * Loads every `.yml`/`.yaml` workflow in a directory.
 *
 * @param {string} directory
 * @returns {Promise<Array<{ name: string, path: string, pullRequest: { paths: string[] | null, branches: string[] | null, types: string[] | null } | null }>>}
 */
export async function loadWorkflows(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const workflows = [];
  for (const file of files) {
    const absolute = path.join(directory, file);
    const source = await readFile(absolute, 'utf8');
    workflows.push(parseWorkflow(source, `.github/workflows/${file}`));
  }
  return workflows;
}

/**
 * Selects the run that represents a workflow's current state at the head SHA.
 *
 * A re-run keeps the run id and increments `run_attempt`, so the highest attempt
 * is the one whose conclusion counts.
 *
 * @param {Array<Record<string, unknown>>} runs
 * @returns {Map<string, Record<string, any>>}
 */
export function indexRunsByWorkflow(runs) {
  const latest = new Map();
  for (const run of runs) {
    if (!run || typeof run.path !== 'string') {
      continue;
    }
    const current = latest.get(run.path);
    if (!current) {
      latest.set(run.path, run);
      continue;
    }
    const attempt = Number(run.run_attempt ?? 1);
    const currentAttempt = Number(current.run_attempt ?? 1);
    if (attempt > currentAttempt || (attempt === currentAttempt && Number(run.id) > Number(current.id))) {
      latest.set(run.path, run);
    }
  }
  return latest;
}

/**
 * Works out which workflows this pull request has to wait for.
 *
 * The result is the union of the workflows whose own filter matches the diff and
 * the workflows that created a run regardless, minus the gate itself and the
 * advisory list.
 *
 * @param {object} options
 * @param {Array<{ name: string, path: string, pullRequest: { paths: string[] | null, branches: string[] | null, types: string[] | null } | null }>} options.workflows
 * @param {string[]} options.changedFiles
 * @param {string} options.baseRef
 * @param {Set<string>} options.advisoryPaths
 * @param {string} options.selfPath
 * @param {Map<string, Record<string, any>>} options.startedRuns
 * @returns {{ expected: Map<string, string>, filteredOut: Array<{ name: string, path: string }>, notApplicable: Array<{ name: string, path: string }> }}
 */
export function planGate({ workflows, changedFiles, baseRef, advisoryPaths, selfPath, startedRuns }) {
  const expected = new Map();
  const filteredOut = [];
  const notApplicable = [];

  for (const workflow of workflows) {
    if (workflow.path === selfPath || advisoryPaths.has(workflow.path)) {
      continue;
    }
    if (!workflow.pullRequest) {
      notApplicable.push({ name: workflow.name, path: workflow.path });
      continue;
    }
    if (!matchesFilter(workflow.pullRequest.branches, [baseRef])) {
      filteredOut.push({ name: workflow.name, path: workflow.path });
      continue;
    }
    if (!matchesFilter(workflow.pullRequest.paths, changedFiles)) {
      filteredOut.push({ name: workflow.name, path: workflow.path });
      continue;
    }
    expected.set(workflow.path, workflow.name);
  }

  for (const [workflowPath, run] of startedRuns) {
    if (workflowPath === selfPath || advisoryPaths.has(workflowPath)) {
      continue;
    }
    if (!expected.has(workflowPath)) {
      expected.set(workflowPath, typeof run.name === 'string' ? run.name : workflowPath);
    }
  }

  return { expected, filteredOut, notApplicable };
}

/**
 * Classifies every expected workflow against the runs observed at the head SHA.
 *
 * @param {Map<string, string>} expected
 * @param {Map<string, Record<string, any>>} runs
 * @returns {{ passing: Array<object>, failing: Array<object>, pending: Array<object>, missing: Array<object> }}
 */
export function evaluateGate(expected, runs) {
  const passing = [];
  const failing = [];
  const pending = [];
  const missing = [];

  for (const [workflowPath, name] of expected) {
    const run = runs.get(workflowPath);
    if (!run) {
      missing.push({ name, path: workflowPath });
      continue;
    }
    const entry = { name, path: workflowPath, conclusion: run.conclusion, attempt: run.run_attempt };
    if (run.status !== 'completed') {
      pending.push(entry);
      continue;
    }
    if (PASSING_CONCLUSIONS.has(String(run.conclusion))) {
      passing.push(entry);
    } else {
      failing.push(entry);
    }
  }

  return { passing, failing, pending, missing };
}

/**
 * @param {number} milliseconds
 * @returns {Promise<void>}
 */
function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * Calls the REST API with retries for the transient failure modes the gate can
 * see while a matrix of workflows starts.
 *
 * @param {string} endpoint path beginning with `/`
 * @param {string} token
 * @returns {Promise<any>}
 */
async function github(endpoint, token) {
  const url = endpoint.startsWith('http') ? endpoint : `https://api.github.com${endpoint}`;
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
    });
    if (response.ok) {
      return response.json();
    }
    lastError = new Error(`GitHub API ${response.status} for ${url}: ${await response.text()}`);
    if (response.status !== 403 && response.status !== 429 && response.status < 500) {
      throw lastError;
    }
    await sleep(attempt * 3000);
  }
  throw lastError;
}

/**
 * Lists every file changed by the pull request, across all pages.
 *
 * @param {string} repository `owner/name`
 * @param {number} pullNumber
 * @param {string} token
 * @returns {Promise<string[]>}
 */
async function listChangedFiles(repository, pullNumber, token) {
  const files = [];
  for (let page = 1; page <= 30; page += 1) {
    const batch = await github(
      `/repos/${repository}/pulls/${pullNumber}/files?per_page=100&page=${page}`,
      token,
    );
    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }
    for (const file of batch) {
      if (typeof file.filename === 'string') {
        files.push(file.filename);
      }
      if (typeof file.previous_filename === 'string') {
        files.push(file.previous_filename);
      }
    }
    if (batch.length < 100) {
      break;
    }
  }
  return [...new Set(files)];
}

/**
 * Lists the pull-request-triggered workflow runs recorded at one head SHA.
 *
 * @param {string} repository
 * @param {string} headSha
 * @param {string} token
 * @returns {Promise<Array<Record<string, any>>>}
 */
async function listRunsAtHead(repository, headSha, token) {
  const runs = [];
  for (let page = 1; page <= 10; page += 1) {
    const response = await github(
      `/repos/${repository}/actions/runs?head_sha=${headSha}&per_page=100&page=${page}`,
      token,
    );
    const batch = Array.isArray(response?.workflow_runs) ? response.workflow_runs : [];
    if (batch.length === 0) {
      break;
    }
    for (const run of batch) {
      if (run.event === 'pull_request' && run.head_sha === headSha) {
        runs.push(run);
      }
    }
    if (batch.length < 100) {
      break;
    }
  }
  return runs;
}

function describe(entry) {
  return `${entry.name} (${entry.path})${entry.conclusion ? ` -> ${entry.conclusion}` : ''}`;
}

async function main() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const pullNumber = Number(process.env.PR_NUMBER);
  const headSha = process.env.HEAD_SHA;
  const baseRef = process.env.BASE_REF || 'main';

  if (!token || !repository || !Number.isFinite(pullNumber) || !headSha) {
    throw new Error('GH_TOKEN, GITHUB_REPOSITORY, PR_NUMBER and HEAD_SHA are required.');
  }

  const timeoutSeconds = Number(process.env.GATE_TIMEOUT_SECONDS || 4200);
  const pollSeconds = Number(process.env.GATE_POLL_SECONDS || 30);
  const startGraceSeconds = Number(process.env.GATE_START_GRACE_SECONDS || 300);
  const deadline = Date.now() + timeoutSeconds * 1000;

  const workflowsDirectory = fileURLToPath(new URL('../workflows/', import.meta.url));
  const workflows = await loadWorkflows(workflowsDirectory);
  const selfPath = '.github/workflows/ci-gate.yml';
  const advisoryPaths = new Set(
    workflows
      .filter((workflow) => ADVISORY_WORKFLOW_NAMES.has(workflow.name))
      .map((workflow) => workflow.path),
  );

  const changedFiles = await listChangedFiles(repository, pullNumber, token);
  console.log(`Changed files (${changedFiles.length}):`);
  for (const file of changedFiles) {
    console.log(`  ${file}`);
  }

  const firstSeen = new Map();
  let plan = null;
  let gate = null;

  for (;;) {
    const runs = await listRunsAtHead(repository, headSha, token);
    const startedRuns = indexRunsByWorkflow(runs);
    plan = planGate({ workflows, changedFiles, baseRef, advisoryPaths, selfPath, startedRuns });
    gate = evaluateGate(plan.expected, startedRuns);

    console.log(
      `[${new Date().toISOString()}] expected=${plan.expected.size} passing=${gate.passing.length} ` +
        `pending=${gate.pending.length} failing=${gate.failing.length} missing=${gate.missing.length}`,
    );

    if (plan.expected.size === 0) {
      break;
    }
    if (gate.pending.length === 0 && gate.failing.length === 0 && gate.missing.length === 0) {
      break;
    }
    if (Date.now() >= deadline) {
      break;
    }

    const now = Date.now();
    let graceExpired = false;
    for (const entry of gate.missing) {
      if (!firstSeen.has(entry.path)) {
        firstSeen.set(entry.path, now);
      } else if (now - firstSeen.get(entry.path) > startGraceSeconds * 1000) {
        graceExpired = true;
      }
    }
    for (const path of [...firstSeen.keys()]) {
      if (!gate.missing.some((entry) => entry.path === path)) {
        firstSeen.delete(path);
      }
    }
    if (graceExpired) {
      console.log('A workflow whose own filter matches this diff never started.');
      break;
    }

    await sleep(pollSeconds * 1000);
  }

  console.log('');
  console.log('Aggregate CI gate');
  console.log('=================');
  console.log(`Head SHA: ${headSha}`);
  console.log(`Base ref: ${baseRef}`);
  console.log('');
  console.log(`Waiting on ${plan.expected.size} component workflow(s):`);
  for (const [workflowPath, name] of plan.expected) {
    console.log(`  - ${name} (${workflowPath})`);
  }
  if (advisoryPaths.size > 0) {
    console.log('');
    console.log('Advisory workflows excluded from the decision:');
    for (const workflowPath of advisoryPaths) {
      console.log(`  - ${workflowPath}`);
    }
  }
  if (plan.filteredOut.length > 0) {
    console.log('');
    console.log('Not triggered by this diff (path or branch filter):');
    for (const entry of plan.filteredOut) {
      console.log(`  - ${entry.name} (${entry.path})`);
    }
  }

  if (gate.passing.length > 0) {
    console.log('');
    console.log('Passed:');
    for (const entry of gate.passing) {
      console.log(`  - ${describe(entry)}`);
    }
  }

  const problems = [...gate.failing, ...gate.missing, ...gate.pending];
  if (problems.length === 0) {
    console.log('');
    console.log('All component workflows that apply to this diff passed at the head SHA.');
    return;
  }

  if (gate.failing.length > 0) {
    console.log('');
    console.log('::error::Component workflows did not pass at this head SHA:');
    for (const entry of gate.failing) {
      console.log(`::error::  - ${describe(entry)}`);
    }
  }
  if (gate.missing.length > 0) {
    console.log('');
    console.log('::error::Component workflows that should have run never reported at this head SHA:');
    for (const entry of gate.missing) {
      console.log(`::error::  - ${describe(entry)}`);
    }
  }
  if (gate.pending.length > 0) {
    console.log('');
    console.log('::error::Component workflows were still running when the gate timed out:');
    for (const entry of gate.pending) {
      console.log(`::error::  - ${describe(entry)}`);
    }
  }

  process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
