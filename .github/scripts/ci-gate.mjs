#!/usr/bin/env node
/**
 * Aggregate CI gate.
 *
 * Most component workflows in this repository are path-filtered, so a pull
 * request that touches one area starts only the lanes that cover it. A required
 * check that names a component workflow therefore stays pending forever on any
 * pull request its filter does not match; requiring nothing lets a change merge
 * without evidence.
 *
 * This script backs the single always-running required check,
 * `CI gate (aggregate)`. It:
 *
 *   - reads every component workflow's own `on.pull_request` filter from the
 *     base revision, so a filter is declared once, in the workflow that owns it;
 *   - evaluates only workflow runs created for this pull request at this exact
 *     head SHA, choosing the newest run and its latest attempt;
 *   - fails on failure, cancellation, timeout, action_required, startup_failure,
 *     stale, neutral, skipped, or a completed run with no conclusion;
 *   - fails when a workflow whose filter matches the diff never reports at all;
 *   - excludes its own workflow, so it cannot wait on itself;
 *   - never evaluates a failed or partial API read as an empty snapshot;
 *   - fails closed on `merge_group` unless every gating workflow also declares
 *     that trigger, in which case it verifies the merge candidate for real;
 *   - executes from the base revision on pull requests, with a loudly-marked,
 *     owner-only bootstrap fallback for the pull request that introduces it;
 *   - requires an owner approval when an external contributor changes the CI
 *     control plane that judges their own pull request.
 *
 * Usage: node .github/scripts/ci-gate.mjs
 *   GATE_MODE=aggregate|verify
 *   GH_TOKEN / GITHUB_TOKEN, GITHUB_REPOSITORY, HEAD_SHA, BASE_SHA, BASE_REF
 *   GATE_EVENT=pull_request|merge_group|push|workflow_dispatch
 *   GATE_TRUSTED=true|false, BASE_GATE_PRESENT=true|false
 *   PR_NUMBER, PR_ACTION, PR_AUTHOR, PR_AUTHOR_ASSOCIATION
 *   WORKFLOWS_DIR, GATE_CODEOWNERS
 */

import { appendFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export const GATE_JOB_NAME = 'CI gate (aggregate)';
export const SELF_PATH = '.github/workflows/ci-gate.yml';
export const API_ROOT = 'https://api.github.com';
export const DEFAULT_PR_TYPES = ['opened', 'synchronize', 'reopened'];
export const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER']);

/**
 * A run must affirmatively succeed. `skipped` and `neutral` are deliberately
 * absent: a lane that did not run, or only tolerated a failure, verified
 * nothing and cannot satisfy a required check.
 */
export const PASSING_CONCLUSIONS = new Set(['success']);

/**
 * Changes under these paths can weaken the check that judges the pull request.
 * An external contributor needs an owner approval at the exact head for them.
 */
export const GATE_CONTROL_PATHS = [
  '.github/workflows/',
  '.github/scripts/ci-gate.mjs',
  '.github/scripts/ci-gate.test.mjs',
  '.github/CODEOWNERS',
];

export const DEFAULTS = {
  timeoutSeconds: 90 * 60,
  pollSeconds: 30,
  startGraceSeconds: 5 * 60,
  settleSeconds: 60,
  emptySettleSeconds: 60,
  apiRetries: 4,
  retryBaseMs: 2_000,
  maxRunPages: 10,
  maxStatusPages: 10,
  maxFilePages: 30,
  maxReviewPages: 10,
};

function escapeRegExp(character) {
  return /[.*+?^${}()|[\]\\]/.test(character) ? `\\${character}` : character;
}

/**
 * Translates the GitHub path-filter subset this repository uses into an
 * anchored regular expression. `**` crosses path segments, `*` stays inside
 * one segment, `[]` is a character class, and `?` makes the previous atom optional.
 */
export function globToRegExp(glob) {
  const atoms = [];
  let index = 0;
  while (index < glob.length) {
    const character = glob[index];
    if (character === '*') {
      if (glob[index + 1] === '*') {
        if (glob[index + 2] === '/') {
          atoms.push('(?:.*/)?');
          index += 3;
        } else {
          atoms.push('.*');
          index += 2;
        }
      } else {
        atoms.push('[^/]*');
        index += 1;
      }
      continue;
    }
    if (character === '?') {
      const previous = atoms.pop();
      atoms.push(previous === undefined ? escapeRegExp(character) : `(?:${previous})?`);
      index += 1;
      continue;
    }
    if (character === '[') {
      const end = glob.indexOf(']', index + 1);
      if (end === -1) {
        atoms.push('\\[');
        index += 1;
        continue;
      }
      let body = glob.slice(index + 1, end);
      if (body.startsWith('!')) {
        body = `^${body.slice(1)}`;
      }
      atoms.push(`[${body.replaceAll('\\', '\\\\')}]`);
      index = end + 1;
      continue;
    }
    atoms.push(escapeRegExp(character));
    index += 1;
  }
  return new RegExp(`^${atoms.join('')}$`);
}

/**
 * The last matching pattern decides whether a changed file is included.
 * Preserve the gate's fallback for lists containing only exclusions.
 */
export function matchesPathFilter(patterns, candidates) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return true;
  }
  const rules = patterns.map((pattern) => {
    const include = !pattern.startsWith('!');
    return { include, matcher: globToRegExp(include ? pattern : pattern.slice(1)) };
  });
  const defaultInclude = rules.every((rule) => !rule.include);
  return candidates.some(
    (candidate) =>
      rules.findLast(({ matcher }) => matcher.test(candidate))?.include ?? defaultInclude,
  );
}

/**
 * GitHub's `paths-ignore` semantics: the workflow is skipped only when every
 * changed file matches an ignored pattern.
 */
export function matchesIgnoreFilter(patterns, candidates) {
  if (!Array.isArray(patterns) || patterns.length === 0 || candidates.length === 0) {
    return false;
  }
  const matchers = patterns.map((pattern) => globToRegExp(pattern));
  return candidates.every((candidate) => matchers.some((matcher) => matcher.test(candidate)));
}

export function matchesRefFilter(patterns, ref) {
  return matchesPathFilter(patterns, [ref]);
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function stripComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (character === quote && line[index - 1] !== '\\') {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '#' && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index);
    }
  }
  return line;
}

function parseInlineList(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((entry) => unquote(entry))
      .filter(Boolean);
  }
  return [unquote(trimmed)];
}

function parseJobNames(lines) {
  const jobsIndex = lines.findIndex((line) => /^jobs\s*:/.test(stripComment(line)));
  if (jobsIndex === -1) {
    return [];
  }
  const names = [];
  let current = null;
  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
    const line = stripComment(lines[index]);
    if (line.trim().length === 0) {
      continue;
    }
    if (!/^\s/.test(line)) {
      break;
    }
    const indent = line.length - line.trimStart().length;
    if (indent === 2) {
      const match = line.trim().match(/^([A-Za-z0-9_-]+)\s*:/);
      current = match ? match[1] : null;
      if (current) {
        names.push(current);
      }
      continue;
    }
    if (indent === 4 && current) {
      const match = line.trim().match(/^name\s*:\s*(.+)$/);
      if (match) {
        const parsed = unquote(match[1]);
        if (parsed.length > 0) {
          names[names.length - 1] = parsed;
        }
      }
    }
  }
  return names;
}

function readList(lines, index, indent) {
  const raw = stripComment(lines[index]);
  const inline = raw
    .slice(indent)
    .replace(/^[^:]+:\s*/, '')
    .trim();
  if (inline.startsWith('[')) {
    return { values: parseInlineList(inline), nextIndex: index + 1 };
  }
  if (inline.length > 0 && inline !== 'null' && inline !== '~') {
    return { values: [unquote(inline)], nextIndex: index + 1 };
  }

  const values = [];
  let cursor = index + 1;
  while (cursor < lines.length) {
    const line = stripComment(lines[cursor]);
    if (line.trim().length === 0) {
      cursor += 1;
      continue;
    }
    const lineIndent = line.length - line.trimStart().length;
    if (lineIndent !== indent + 2 || !line.trimStart().startsWith('- ')) {
      break;
    }
    const value = unquote(line.trimStart().slice(2));
    if (value.length > 0) {
      values.push(value);
    }
    cursor += 1;
  }
  return { values, nextIndex: cursor };
}

/**
 * Extracts the workflow name, its `pull_request` filters and whether it declares
 * `merge_group`. The parser intentionally supports the YAML shape GitHub
 * workflows actually use here; `ci-gate.test.mjs` exercises it against every
 * workflow in the repository so a new syntax shows up as a test failure rather
 * than a silently absent required lane.
 */
export function parseWorkflow(source, workflowPath) {
  const lines = source.split(/\r?\n/);
  const jobNames = parseJobNames(lines);

  let name = workflowPath;
  const nameIndex = lines.findIndex((line) => /^['"]?name['"]?\s*:/.test(line));
  if (nameIndex !== -1) {
    const parsed = unquote(stripComment(lines[nameIndex]).replace(/^['"]?name['"]?\s*:\s*/, ''));
    if (parsed.length > 0) {
      name = parsed;
    }
  }

  const onIndex = lines.findIndex((line) => /^['"]?on['"]?\s*:/.test(line));
  if (onIndex === -1) {
    return { name, path: workflowPath, pullRequest: null, mergeGroup: false, jobNames };
  }

  const inlineTriggers = stripComment(lines[onIndex])
    .replace(/^['"]?on['"]?\s*:\s*/, '')
    .trim();
  if (inlineTriggers.length > 0) {
    if (inlineTriggers.startsWith('{') && !/^\{\s*\}$/.test(inlineTriggers)) {
      throw new Error(`${workflowPath}: use block syntax for the on trigger mapping.`);
    }
    const triggers = parseInlineList(inlineTriggers);
    return {
      name,
      path: workflowPath,
      pullRequest: triggers.includes('pull_request')
        ? { paths: null, pathsIgnore: null, branches: null, branchesIgnore: null, types: null }
        : null,
      mergeGroup: triggers.includes('merge_group'),
      jobNames,
    };
  }

  let pullRequestIndex = -1;
  let pullRequestInline = '';
  let mergeGroup = false;
  let mergeGroupFilters;
  for (let index = onIndex + 1; index < lines.length; index += 1) {
    const line = stripComment(lines[index]);
    if (line.trim().length === 0) {
      continue;
    }
    if (!/^\s/.test(line)) {
      break;
    }
    if (line.length - line.trimStart().length !== 2) {
      continue;
    }
    const key = line
      .trim()
      .replace(/:.*$/, '')
      .replace(/^['"]|['"]$/g, '');
    if (key === 'merge_group') {
      mergeGroup = true;
      const inline = line.trim().replace(/^['"]?merge_group['"]?\s*:\s*/, '');
      if (inline && !isEmptyTrigger(inline)) {
        throw new Error(`${workflowPath}: use block syntax for merge_group filters.`);
      }
      mergeGroupFilters = readTriggerFilters(lines, index, {
        branches: 'branches',
        'branches-ignore': 'branchesIgnore',
        types: 'types',
      });
    }
    if (key === 'pull_request') {
      pullRequestIndex = index;
      pullRequestInline = line
        .trim()
        .replace(/^['"]?pull_request['"]?\s*:\s*/, '')
        .trim();
    }
  }

  if (pullRequestInline && !isEmptyTrigger(pullRequestInline)) {
    throw new Error(`${workflowPath}: use block syntax for pull_request filters.`);
  }
  const pullRequest =
    pullRequestIndex === -1
      ? null
      : readTriggerFilters(lines, pullRequestIndex, {
          paths: 'paths',
          'paths-ignore': 'pathsIgnore',
          branches: 'branches',
          'branches-ignore': 'branchesIgnore',
          types: 'types',
        });
  return { name, path: workflowPath, pullRequest, mergeGroup, mergeGroupFilters, jobNames };
}

function isEmptyTrigger(value) {
  return /^(?:\{\s*\}|null|Null|NULL|~)$/.test(value);
}

function readTriggerFilters(lines, triggerIndex, keys) {
  const filters = Object.fromEntries(Object.values(keys).map((key) => [key, null]));
  for (let index = triggerIndex + 1; index < lines.length; index += 1) {
    const line = stripComment(lines[index]);
    if (line.trim().length === 0) {
      continue;
    }
    if (!/^\s/.test(line)) {
      break;
    }
    const lineIndent = line.length - line.trimStart().length;
    if (lineIndent <= 2) {
      break;
    }
    if (lineIndent !== 4) {
      continue;
    }
    const match = line.trim().match(/^['"]?([a-z-]+)['"]?\s*:/);
    if (!match || !Object.hasOwn(keys, match[1])) {
      continue;
    }
    const { values, nextIndex } = readList(lines, index, 4);
    filters[keys[match[1]]] = values.length > 0 ? values : null;
    index = nextIndex - 1;
  }

  return filters;
}

export async function loadWorkflows(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const workflows = [];
  for (const file of files) {
    const source = await readFile(path.join(directory, file), 'utf8');
    workflows.push(parseWorkflow(source, `.github/workflows/${file}`));
  }
  return workflows;
}

/**
 * Selects the run that represents a workflow's current state at the head.
 * A re-run keeps the run id and increments `run_attempt`; the newest attempt is
 * the one whose conclusion counts. An older success cannot mask a newer
 * cancellation.
 */
export function selectRun(runs, workflowPath, { headSha, event, repository, pullNumber }) {
  const candidates = (Array.isArray(runs) ? runs : []).filter((run) => {
    if (!run || run.path !== workflowPath) {
      return false;
    }
    if (run.head_sha !== headSha || run.event !== event) {
      return false;
    }
    if (repository && run.repository?.full_name && run.repository.full_name !== repository) {
      return false;
    }
    if (
      pullNumber &&
      Array.isArray(run.pull_requests) &&
      run.pull_requests.length > 0 &&
      !run.pull_requests.some((entry) => entry?.number === pullNumber)
    ) {
      return false;
    }
    return true;
  });

  candidates.sort(
    (left, right) =>
      Number(right.id ?? 0) - Number(left.id ?? 0) ||
      Number(right.run_attempt ?? 1) - Number(left.run_attempt ?? 1) ||
      String(right.created_at ?? '').localeCompare(String(left.created_at ?? '')),
  );
  return candidates[0] ?? null;
}

/**
 * Works out which base-revision workflows this pull request has to satisfy.
 *
 * The expected set is the workflows whose own path/branch filters match the
 * diff, plus any base-revision workflow that actually started at this head (so
 * a filter parser disagreement fails toward waiting, not toward an early green).
 * A workflow newly added by the pull request is not a required lane: only the
 * base revision decides what must gate.
 */
export function planGate({
  workflows,
  changedFiles,
  baseRef,
  action,
  selfPath = SELF_PATH,
  observedRuns = [],
}) {
  const expected = new Map();
  const filteredOut = [];
  const notApplicable = [];
  const actionExcluded = [];
  const errors = [];
  const known = new Map(workflows.map((workflow) => [workflow.path, workflow]));

  for (const workflow of workflows) {
    if (workflow.path === selfPath) {
      continue;
    }
    if (action === 'merge_group' ? !workflow.mergeGroup : !workflow.pullRequest) {
      notApplicable.push({ name: workflow.name, path: workflow.path });
      continue;
    }
    const filter =
      (action === 'merge_group' ? workflow.mergeGroupFilters : workflow.pullRequest) ?? {};
    if (filter.paths && filter.pathsIgnore) {
      errors.push(`${workflow.path} declares both paths and paths-ignore.`);
      continue;
    }
    if (filter.branches && filter.branchesIgnore) {
      errors.push(`${workflow.path} declares both branches and branches-ignore.`);
      continue;
    }
    if (filter.branches && !matchesRefFilter(filter.branches, baseRef)) {
      filteredOut.push({ name: workflow.name, path: workflow.path, reason: 'branches' });
      continue;
    }
    if (filter.branchesIgnore && matchesRefFilter(filter.branchesIgnore, baseRef)) {
      filteredOut.push({ name: workflow.name, path: workflow.path, reason: 'branches-ignore' });
      continue;
    }
    if (filter.paths && !matchesPathFilter(filter.paths, changedFiles)) {
      filteredOut.push({ name: workflow.name, path: workflow.path, reason: 'paths' });
      continue;
    }
    if (filter.pathsIgnore && matchesIgnoreFilter(filter.pathsIgnore, changedFiles)) {
      filteredOut.push({ name: workflow.name, path: workflow.path, reason: 'paths-ignore' });
      continue;
    }

    const mergeGroup = action === 'merge_group';
    const types = filter.types ?? (mergeGroup ? ['checks_requested'] : DEFAULT_PR_TYPES);
    const actionApplies = types.includes(mergeGroup ? 'checks_requested' : action);
    expected.set(workflow.path, {
      name: workflow.name,
      path: workflow.path,
      requiredForMissing: actionApplies,
      observed: false,
    });
    if (!actionApplies) {
      actionExcluded.push({ name: workflow.name, path: workflow.path, types });
    }
  }

  for (const run of observedRuns) {
    if (!run || typeof run.path !== 'string' || run.path === selfPath) {
      continue;
    }
    const workflow = known.get(run.path);
    if (!workflow) {
      continue;
    }
    const current = expected.get(run.path);
    if (current) {
      current.observed = true;
      current.requiredForMissing = true;
      continue;
    }
    expected.set(run.path, {
      name: workflow.name,
      path: run.path,
      requiredForMissing: false,
      observed: true,
    });
  }

  return { expected, filteredOut, notApplicable, actionExcluded, errors };
}

function runSignature(runs, statuses) {
  const runIds = runs
    .map(
      (run) =>
        `${run.path}:${run.id}:${run.run_attempt ?? 1}:${run.status}:${run.conclusion ?? ''}`,
    )
    .sort();
  const statusIds = statuses
    .map((status) => `${status.context}:${status.state}:${status.updated_at ?? ''}`)
    .sort();
  return [...runIds, '--', ...statusIds].join('|');
}

/**
 * Pure decision function over one complete observation. A failed or partial API
 * read never reaches this function; `runGate` skips evaluation in that case.
 */
export function evaluateGate({
  expected,
  runs = [],
  statuses = [],
  now,
  startedAt,
  lastChangeAt,
  firstMissingAt = new Map(),
  previousSignature,
  config = DEFAULTS,
  headSha,
  event = 'pull_request',
  repository,
  pullNumber,
}) {
  const passing = [];
  const failing = [];
  const pending = [];
  const missing = [];
  const selectedRuns = [];

  for (const [workflowPath, entry] of expected) {
    const run = selectRun(runs, workflowPath, {
      headSha,
      event,
      repository,
      pullNumber,
    });
    if (!run) {
      if (entry.requiredForMissing) {
        missing.push({ name: entry.name, path: workflowPath });
      }
      continue;
    }
    selectedRuns.push(run);
    const detail = {
      name: entry.name,
      path: workflowPath,
      id: run.id,
      attempt: run.run_attempt ?? 1,
      conclusion: run.conclusion,
    };
    if (run.status !== 'completed') {
      pending.push(detail);
      continue;
    }
    if (PASSING_CONCLUSIONS.has(String(run.conclusion))) {
      passing.push(detail);
      continue;
    }
    failing.push(detail);
  }

  const failingStatuses = statuses.filter(
    (status) => status?.state === 'failure' || status?.state === 'error',
  );
  const pendingStatuses = statuses.filter((status) => status?.state === 'pending');
  const signature = runSignature(selectedRuns, statuses);
  const changed =
    previousSignature === undefined
      ? selectedRuns.length > 0 || statuses.length > 0
      : previousSignature !== signature;
  const effectiveLastChange = changed ? now : (lastChangeAt ?? startedAt);

  const nextMissing = new Map();
  for (const entry of missing) {
    const since = firstMissingAt.get(entry.path) ?? now;
    nextMissing.set(entry.path, since);
    entry.waitingMs = now - since;
    entry.expired = now - since >= config.startGraceSeconds * 1000;
  }

  const counts = {
    expected: expected.size,
    passing: passing.length,
    failing: failing.length + failingStatuses.length,
    pending: pending.length + pendingStatuses.length,
    missing: missing.length,
  };
  const base = {
    expected: [...expected.values()],
    passing,
    failing,
    pending,
    missing,
    statuses: { failing: failingStatuses, pending: pendingStatuses },
    counts,
    signature,
    lastChangeAt: effectiveLastChange,
    firstMissingAt: nextMissing,
  };

  if (failing.length > 0) {
    return {
      ...base,
      decision: 'fail',
      reason: `Failed component workflows: ${failing
        .map((entry) => `${entry.name} (${entry.conclusion})`)
        .join(', ')}`,
    };
  }
  if (failingStatuses.length > 0) {
    return {
      ...base,
      decision: 'fail',
      reason: `Failed commit statuses: ${failingStatuses.map((entry) => entry.context).join(', ')}`,
    };
  }

  if (now - startedAt >= config.timeoutSeconds * 1000) {
    return {
      ...base,
      decision: 'fail',
      reason: `Timed out after ${Math.round(
        (now - startedAt) / 60_000,
      )} minutes with ${pending.length} pending, ${missing.length} missing and ${
        failing.length + failingStatuses.length
      } failing.`,
    };
  }

  const expired = missing.filter((entry) => entry.expired);
  if (expired.length > 0) {
    return {
      ...base,
      decision: 'fail',
      reason: `Required workflows never reported at this head: ${expired
        .map((entry) => `${entry.name} (${entry.path})`)
        .join(', ')}`,
    };
  }

  if (pending.length > 0) {
    return {
      ...base,
      decision: 'wait',
      reason: `Waiting on component workflows: ${pending.map((entry) => entry.name).join(', ')}`,
    };
  }
  if (pendingStatuses.length > 0) {
    return {
      ...base,
      decision: 'wait',
      reason: `Waiting on commit statuses: ${pendingStatuses
        .map((entry) => entry.context)
        .join(', ')}`,
    };
  }
  if (missing.length > 0) {
    return {
      ...base,
      decision: 'wait',
      reason: `Waiting for required workflows to register: ${missing
        .map((entry) => entry.name)
        .join(', ')}`,
    };
  }

  if (expected.size === 0 && now - startedAt < config.emptySettleSeconds * 1000) {
    return {
      ...base,
      decision: 'wait',
      reason: 'No component workflow matched this diff; confirming no late registration.',
    };
  }
  if (now - effectiveLastChange < config.settleSeconds * 1000) {
    return {
      ...base,
      decision: 'wait',
      reason: 'Every observed check has completed; letting late registrations settle.',
    };
  }

  return {
    ...base,
    decision: 'pass',
    reason:
      expected.size === 0
        ? 'No component workflow matched this diff; nothing was waiting.'
        : `All ${expected.size} applicable component workflow(s) passed at the exact head.`,
  };
}

function startDeadline(startedAt, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('Gate deadline reached.')),
    Math.min(timeoutMs, 2 ** 31 - 1),
  );
  return {
    deadline: startedAt + timeoutMs,
    signal: controller.signal,
    dispose: () => clearTimeout(timer),
  };
}

/**
 * Polls until a decision is reached. If an observation fails, it is discarded
 * rather than evaluated as an empty snapshot; the gate fails at the deadline if
 * no complete observation was ever available.
 */
export async function runGate({
  observe,
  config = DEFAULTS,
  gateDeadline,
  now = () => Date.now(),
  sleep: wait = sleep,
  log = () => {},
}) {
  const startedAt = now();
  const budget = gateDeadline ?? startDeadline(startedAt, config.timeoutSeconds * 1000);
  const { deadline, signal } = budget;
  let lastChangeAt = startedAt;
  let firstMissingAt = new Map();
  let previousSignature;
  let lastResult = null;
  let lastError = null;

  try {
    while (!signal.aborted && now() < deadline) {
      const observation = new AbortController();
      let snapshot;
      try {
        snapshot = await observe(AbortSignal.any([signal, observation.signal]));
        lastError = null;
      } catch (error) {
        lastError = error;
        lastChangeAt = now();
        log(`::warning title=CI gate::Could not read a complete check snapshot: ${error.message}`);
      } finally {
        // If one reader failed, cancel its sibling before retrying the snapshot.
        observation.abort();
      }

      if (!lastError) {
        const result = evaluateGate({
          ...snapshot,
          now: now(),
          startedAt,
          lastChangeAt,
          firstMissingAt,
          previousSignature,
          config,
        });
        firstMissingAt = result.firstMissingAt;
        lastChangeAt = result.lastChangeAt;
        previousSignature = result.signature;
        lastResult = result;

        log(`[${new Date(now()).toISOString()}] ${result.decision}: ${result.reason}`);
        if (
          result.decision === 'fail' ||
          (result.decision === 'pass' && !signal.aborted && now() < deadline)
        ) {
          return result;
        }
      }

      const remaining = deadline - now();
      if (remaining > 0 && !signal.aborted) {
        try {
          await wait(Math.min(config.pollSeconds * 1000, remaining), undefined, { signal });
        } catch (error) {
          if (!signal.aborted) {
            throw error;
          }
        }
      }
    }

    return {
      ...(lastResult ?? {
        expected: [],
        passing: [],
        failing: [],
        pending: [],
        missing: [],
        statuses: { failing: [], pending: [] },
        counts: { expected: 0, passing: 0, failing: 0, pending: 0, missing: 0 },
      }),
      decision: 'fail',
      reason:
        lastError || !lastResult
          ? `Timed out without a complete snapshot of workflow runs and commit statuses: ${lastError?.message ?? 'Gate deadline reached.'}`
          : `Timed out with ${lastResult.counts.pending} pending and ${lastResult.counts.missing} missing.`,
    };
  } finally {
    if (!gateDeadline) budget.dispose();
  }
}

export function parseCodeOwners(source) {
  const owners = new Set();
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (line.length === 0) {
      continue;
    }
    for (const token of line.split(/\s+/)) {
      if (!token.startsWith('@')) {
        continue;
      }
      const name = token.slice(1);
      if (name.length > 0 && !name.includes('/')) {
        owners.add(name);
      }
    }
  }
  return owners;
}

/** A review that does not change the approval state must not erase an approval. */
const DECISIVE_REVIEW_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);

export function latestReviews(reviews) {
  const byUser = new Map();
  for (const review of Array.isArray(reviews) ? reviews : []) {
    const login = review?.user?.login;
    if (!login || !DECISIVE_REVIEW_STATES.has(review.state)) {
      continue;
    }
    const previous = byUser.get(login);
    if (!previous || String(review.submitted_at ?? '') >= String(previous.submitted_at ?? '')) {
      byUser.set(login, review);
    }
  }
  return [...byUser.values()];
}

/**
 * A pull request must not be able to weaken the check that judges it. Any
 * change under the CI control paths needs an owner approval at the exact head,
 * unless the author is already an owner or member of the repository.
 */
export function evaluateGateChangeGuard({
  changedFiles,
  authorAssociation,
  author,
  reviews,
  owners,
  headSha,
  controlPaths = GATE_CONTROL_PATHS,
}) {
  const touches = (Array.isArray(changedFiles) ? changedFiles : []).filter((file) =>
    controlPaths.some((control) =>
      control.endsWith('/') ? file.startsWith(control) : file === control,
    ),
  );
  if (touches.length === 0) {
    return { required: false, ok: true, touches: [] };
  }
  if (TRUSTED_ASSOCIATIONS.has(authorAssociation)) {
    return { required: true, ok: true, touches, trustedAuthor: true };
  }
  // A base-revision user code owner is trusted for the control paths they own.
  // The author cannot add themselves to the base CODEOWNERS from the change
  // under review, so this cannot be used by an outside contributor.
  if (owners && author && owners.has(author)) {
    return { required: true, ok: true, touches, trustedAuthor: true, codeOwner: true };
  }
  if (!owners || owners.size === 0) {
    return {
      required: true,
      ok: false,
      touches,
      reason: 'No user code owner is recorded in .github/CODEOWNERS.',
    };
  }
  const approvals = latestReviews(reviews).filter(
    (review) =>
      review.state === 'APPROVED' &&
      review.commit_id === headSha &&
      owners.has(review.user?.login) &&
      review.user?.login !== author,
  );
  return {
    required: true,
    ok: approvals.length > 0,
    touches,
    approvals: approvals.map((review) => review.user.login),
    reason:
      approvals.length > 0
        ? ''
        : 'CI control files changed; an owner approval at this exact head is required.',
  };
}

/**
 * The pull request that introduces the gate has no trusted copy at its base.
 * That bootstrap is allowed only for an owner or member, is reported loudly, and
 * disappears as soon as the base revision contains the gate.
 */
export function evaluateBootstrap({
  baseGatePresent,
  authorAssociation,
  trusted,
  bootstrapAuthorized = false,
}) {
  if (baseGatePresent) {
    return {
      ok: trusted,
      bootstrap: false,
      reason: trusted ? '' : 'The base revision has the gate but trusted logic was not selected.',
    };
  }
  if (!TRUSTED_ASSOCIATIONS.has(authorAssociation) && !bootstrapAuthorized) {
    return {
      ok: false,
      bootstrap: true,
      reason:
        'The base revision has no trusted gate and this author is not an OWNER, MEMBER or base code owner. Refusing to execute pull-request-owned gate logic.',
    };
  }
  return {
    ok: true,
    bootstrap: true,
    reason: bootstrapAuthorized
      ? 'Bootstrap: the base revision has no gate; the author is a base code owner. This run executes the pull request copy and must be reviewed manually.'
      : 'Bootstrap: the base revision has no gate; this run executes the pull request copy and must be reviewed manually.',
  };
}

/**
 * Genuine merge-queue support requires every gating component workflow to also
 * declare `merge_group`. Until that is true, the gate fails closed rather than
 * reporting success because no component runs exist.
 */
export function mergeGroupSupport({ workflows, selfPath = SELF_PATH }) {
  const missing = [];
  let components = 0;
  for (const workflow of workflows) {
    if (workflow.path === selfPath || !workflow.pullRequest) {
      continue;
    }
    components += 1;
    if (!workflow.mergeGroup) {
      missing.push({ name: workflow.name, path: workflow.path });
    }
  }
  if (components === 0) {
    return { supported: false, missing, reason: 'No component pull-request workflows exist.' };
  }
  return {
    supported: missing.length === 0,
    missing,
    reason:
      missing.length === 0
        ? ''
        : 'Component workflows do not declare merge_group, so a merge candidate cannot be verified.',
  };
}

export function verifyInstallation({ workflows, selfPath = SELF_PATH }) {
  const problems = [];
  const self = workflows.find((workflow) => workflow.path === selfPath);
  if (!self) {
    problems.push(`${selfPath} is missing from the installed workflows.`);
  } else {
    if (!self.pullRequest) {
      problems.push(`${selfPath} does not run on pull_request.`);
    } else {
      if (
        Array.isArray(self.pullRequest.branches) &&
        !matchesRefFilter(self.pullRequest.branches, 'main')
      ) {
        problems.push(`${selfPath} does not run for pull requests targeting main.`);
      }
      if (
        Array.isArray(self.pullRequest.branchesIgnore) &&
        matchesRefFilter(self.pullRequest.branchesIgnore, 'main')
      ) {
        problems.push(`${selfPath} ignores pull requests targeting main.`);
      }
      if (Array.isArray(self.pullRequest.types)) {
        const missingTypes = ['opened', 'synchronize', 'reopened'].filter(
          (type) => !self.pullRequest.types.includes(type),
        );
        if (missingTypes.length > 0) {
          problems.push(
            `${selfPath} does not run for ordinary pull request activity: ${missingTypes.join(', ')}.`,
          );
        }
      }
    }
    if (Array.isArray(self.jobNames) && !self.jobNames.includes(GATE_JOB_NAME)) {
      problems.push(`${selfPath} does not define the required job name \`${GATE_JOB_NAME}\`.`);
    }
    if (self.pullRequest?.paths) {
      problems.push(`${selfPath} has a paths filter; the required check would go pending.`);
    }
    if (self.pullRequest?.pathsIgnore) {
      problems.push(`${selfPath} has a paths-ignore filter; the required check could be skipped.`);
    }
    if (!self.mergeGroup) {
      problems.push(`${selfPath} does not declare merge_group, so a merge queue would hang.`);
    }
  }
  if (!workflows.some((workflow) => workflow.path !== selfPath && workflow.pullRequest)) {
    problems.push('No component pull-request workflows are installed.');
  }
  return { ok: problems.length === 0, problems };
}

class ApiError extends Error {
  constructor(message, { status, retryAt } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAt = retryAt;
  }
}

function nextLink(header) {
  if (!header) {
    return null;
  }
  for (const part of header.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

async function requestJson(url, token, options = {}) {
  const {
    signal,
    retries = DEFAULTS.apiRetries,
    retryBaseMs = DEFAULTS.retryBaseMs,
    apiRoot = API_ROOT,
  } = options;
  const target = url.startsWith('http') ? url : `${apiRoot}${url}`;
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    signal?.throwIfAborted();
    let response;
    try {
      response = await fetch(target, {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28',
          'user-agent': 'coderax-ci-gate',
        },
        signal,
      });
    } catch (error) {
      signal?.throwIfAborted();
      lastError = error;
      if (attempt === retries) {
        break;
      }
      await sleep(Math.min(retryBaseMs * attempt, 60_000), undefined, { signal });
      continue;
    }

    if (response.ok) {
      try {
        return { data: await response.json(), headers: response.headers };
      } catch (error) {
        signal?.throwIfAborted();
        lastError = new ApiError(`Invalid JSON from ${target}: ${error.message}`, {
          status: response.status,
        });
      }
    } else {
      const text = (await response.text()).slice(0, 300);
      const retryAt = rateLimitRetryAt(response);
      lastError = new ApiError(`${response.status} ${response.statusText} for ${target}: ${text}`, {
        status: response.status,
        retryAt,
      });
      if (response.status !== 403 && response.status !== 429 && response.status < 500) {
        throw lastError;
      }
    }

    if (attempt < retries) {
      const delay = lastError.retryAt
        ? Math.max(0, lastError.retryAt - Date.now())
        : retryBaseMs * attempt;
      await sleep(Math.min(delay, 60_000), undefined, { signal });
    }
  }
  throw lastError;
}

function rateLimitRetryAt(response) {
  if (response.status !== 403 && response.status !== 429) {
    return undefined;
  }
  const remaining = response.headers.get('x-ratelimit-remaining');
  const resetSeconds = Number(response.headers.get('x-ratelimit-reset'));
  const retryAfterSeconds = Number(response.headers.get('retry-after'));
  if (remaining === '0' && Number.isFinite(resetSeconds) && resetSeconds > 0) {
    return Math.min(resetSeconds * 1000 + 1000, Date.now() + 60_000);
  }
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Date.now() + Math.min(retryAfterSeconds * 1000, 60_000);
  }
  return undefined;
}

async function paginate(url, token, { maxPages, extract, signal, config }) {
  const items = [];
  let next = url;
  let pages = 0;
  while (next) {
    if (pages >= maxPages) {
      throw new ApiError(
        `Pagination for ${url} exceeded ${maxPages} pages; refusing a partial view.`,
      );
    }
    const { data, headers } = await requestJson(next, token, {
      signal,
      retries: config.apiRetries,
      retryBaseMs: config.retryBaseMs,
    });
    const batch = extract(data);
    if (!Array.isArray(batch)) {
      throw new ApiError(`Unexpected response shape from ${next}.`);
    }
    items.push(...batch);
    pages += 1;
    next = nextLink(headers.get('link'));
  }
  return items;
}

export async function listRunsAtHead({
  repo,
  headSha,
  token,
  event = 'pull_request',
  pullNumber,
  config = DEFAULTS,
  signal,
}) {
  const url = `${API_ROOT}/repos/${repo}/actions/runs?head_sha=${encodeURIComponent(
    headSha,
  )}&per_page=100`;
  const runs = await paginate(url, token, {
    maxPages: config.maxRunPages,
    extract: (data) => data.workflow_runs,
    signal,
    config,
  });
  return runs.filter((run) => {
    if (run?.head_sha !== headSha || run.event !== event) {
      return false;
    }
    if (run.repository?.full_name && run.repository.full_name !== repo) {
      return false;
    }
    if (
      pullNumber &&
      Array.isArray(run.pull_requests) &&
      run.pull_requests.length > 0 &&
      !run.pull_requests.some((entry) => entry?.number === pullNumber)
    ) {
      return false;
    }
    return true;
  });
}

export async function listStatuses({ repo, headSha, token, config = DEFAULTS, signal }) {
  const url = `${API_ROOT}/repos/${repo}/commits/${headSha}/status?per_page=100`;
  return paginate(url, token, {
    maxPages: config.maxStatusPages,
    extract: (data) => {
      if (data?.sha && data.sha !== headSha) {
        throw new ApiError(`Commit status response was for ${data.sha}, not ${headSha}.`);
      }
      return data.statuses;
    },
    signal,
    config,
  });
}

export async function listChangedFiles({ repo, pullNumber, token, config = DEFAULTS, signal }) {
  const url = `${API_ROOT}/repos/${repo}/pulls/${pullNumber}/files?per_page=100`;
  const files = await paginate(url, token, {
    maxPages: config.maxFilePages,
    extract: (data) => data,
    signal,
    config,
  });
  if (files.length === 0) {
    throw new ApiError(
      'The pull request reported no changed files; refusing to treat an empty diff as a pass.',
    );
  }
  if (files.length >= 3000) {
    throw new ApiError('The pull request diff is too large to evaluate completely.');
  }
  const paths = [];
  for (const file of files) {
    if (typeof file.filename === 'string') {
      paths.push(file.filename);
    }
    if (typeof file.previous_filename === 'string') {
      paths.push(file.previous_filename);
    }
  }
  return [...new Set(paths)];
}

export async function listReviews({ repo, pullNumber, token, config = DEFAULTS, signal }) {
  const url = `${API_ROOT}/repos/${repo}/pulls/${pullNumber}/reviews?per_page=100`;
  return paginate(url, token, {
    maxPages: config.maxReviewPages,
    extract: (data) => data,
    signal,
    config,
  });
}

export async function listCompareFiles({
  repo,
  baseSha,
  headSha,
  token,
  config = DEFAULTS,
  signal,
}) {
  const url = `${API_ROOT}/repos/${repo}/compare/${baseSha}...${headSha}`;
  const { data } = await requestJson(url, token, {
    signal,
    retries: config.apiRetries,
    retryBaseMs: config.retryBaseMs,
  });
  if (!Array.isArray(data?.files)) {
    throw new ApiError(`Compare ${baseSha}...${headSha} returned no file list.`);
  }
  if (data.files.length >= 300) {
    throw new ApiError('The merge candidate diff is too large to evaluate completely.');
  }
  const paths = [];
  for (const file of data.files) {
    if (typeof file.filename === 'string') {
      paths.push(file.filename);
    }
    if (typeof file.previous_filename === 'string') {
      paths.push(file.previous_filename);
    }
  }
  if (paths.length === 0) {
    throw new ApiError('The merge candidate reported no changed files.');
  }
  return [...new Set(paths)];
}

function readConfig(env) {
  const number = (name, fallback) => {
    const raw = env[name];
    if (raw === undefined || raw === '') {
      return fallback;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${name} must be a non-negative number.`);
    }
    return value;
  };

  return {
    timeoutSeconds: number('GATE_TIMEOUT_SECONDS', DEFAULTS.timeoutSeconds),
    pollSeconds: Math.max(1, number('GATE_POLL_SECONDS', DEFAULTS.pollSeconds)),
    startGraceSeconds: number('GATE_START_GRACE_SECONDS', DEFAULTS.startGraceSeconds),
    settleSeconds: number('GATE_SETTLE_SECONDS', DEFAULTS.settleSeconds),
    emptySettleSeconds: number('GATE_EMPTY_SETTLE_SECONDS', DEFAULTS.emptySettleSeconds),
    apiRetries: Math.max(1, number('GATE_API_RETRIES', DEFAULTS.apiRetries)),
    retryBaseMs: number('GATE_RETRY_BASE_MS', DEFAULTS.retryBaseMs),
    maxRunPages: Math.max(1, number('GATE_MAX_RUN_PAGES', DEFAULTS.maxRunPages)),
    maxStatusPages: Math.max(1, number('GATE_MAX_STATUS_PAGES', DEFAULTS.maxStatusPages)),
    maxFilePages: Math.max(1, number('GATE_MAX_FILE_PAGES', DEFAULTS.maxFilePages)),
    maxReviewPages: Math.max(1, number('GATE_MAX_REVIEW_PAGES', DEFAULTS.maxReviewPages)),
  };
}

function summarize(result, context = {}) {
  const lines = [`### ${GATE_JOB_NAME}`, ''];
  if (context.bootstrap) {
    lines.push(
      '> **Bootstrap run.** The base revision has no trusted gate. This run executed the pull request copy and must be reviewed manually.',
      '',
    );
  }
  lines.push(
    `Head: \`${context.headSha ?? 'unknown'}\` · Base: \`${context.baseRef ?? 'unknown'}\` · Event: \`${
      context.event ?? 'unknown'
    }\``,
    '',
    '| Metric | Count |',
    '| --- | --- |',
    `| Expected workflows | ${result.counts.expected} |`,
    `| Passing | ${result.counts.passing} |`,
    `| Failing | ${result.counts.failing} |`,
    `| Pending | ${result.counts.pending} |`,
    `| Missing | ${result.counts.missing} |`,
    '',
    result.reason,
  );

  if (result.failing.length > 0) {
    lines.push('', '**Failed workflows**', '');
    for (const entry of result.failing) {
      lines.push(`- \`${entry.name}\` (${entry.path}) -> ${entry.conclusion}`);
    }
  }
  if (result.missing.length > 0) {
    lines.push('', '**Missing required workflows**', '');
    for (const entry of result.missing) {
      lines.push(`- \`${entry.name}\` (${entry.path})`);
    }
  }
  if (result.pending.length > 0) {
    lines.push('', '**Still running**', '');
    for (const entry of result.pending) {
      lines.push(`- \`${entry.name}\` (${entry.path})`);
    }
  }
  for (const status of result.statuses?.failing ?? []) {
    lines.push('', `- Failed commit status: \`${status.context}\``);
  }
  for (const status of result.statuses?.pending ?? []) {
    lines.push('', `- Pending commit status: \`${status.context}\``);
  }
  return lines.join('\n');
}

function writeSummary(markdown) {
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
}

function fail(message) {
  console.error(`::error title=CI gate::${message}`);
  process.exitCode = 2;
}

async function main() {
  const env = process.env;
  const mode = env.GATE_MODE ?? 'aggregate';
  const config = readConfig(env);
  const workflowsDirectory =
    env.WORKFLOWS_DIR ?? fileURLToPath(new URL('../workflows/', import.meta.url));
  const workflows = await loadWorkflows(workflowsDirectory);

  if (mode === 'verify') {
    const result = verifyInstallation({ workflows });
    if (!result.ok) {
      fail(`Installed gate is not verifiable: ${result.problems.join(' ')}`);
      return;
    }
    writeSummary(
      [
        `### ${GATE_JOB_NAME} installation`,
        '',
        `Verified ${workflows.length} workflow definition(s): the gate has no path filter and declares merge_group.`,
      ].join('\n'),
    );
    return;
  }

  const gateDeadline = startDeadline(Date.now(), config.timeoutSeconds * 1000);
  try {
    await runAggregate({ env, config, workflows, gateDeadline });
  } finally {
    gateDeadline.dispose();
  }
}

async function runAggregate({ env, config, workflows, gateDeadline }) {
  const { signal } = gateDeadline;
  const token = env.GH_TOKEN ?? env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPOSITORY ?? env.REPO;
  const headSha = env.HEAD_SHA;
  const baseSha = env.BASE_SHA;
  // merge_group reports `refs/heads/main`; branch filters are written as `main`.
  const baseRef = (env.BASE_REF ?? 'main')
    .replace(/^refs\/heads\//, '')
    .replace(/^refs\/tags\//, '');
  const event = env.GATE_EVENT ?? 'pull_request';
  const action = env.PR_ACTION ?? 'synchronize';
  const pullNumber = Number(env.PR_NUMBER);
  const author = env.PR_AUTHOR ?? '';
  const authorAssociation = env.PR_AUTHOR_ASSOCIATION ?? '';
  const trusted = env.GATE_TRUSTED === 'true';
  const baseGatePresent = env.BASE_GATE_PRESENT === 'true';
  const bootstrapAuthorized = env.GATE_BOOTSTRAP_AUTHORIZED === 'true';

  if (!token || !repo || !headSha || !baseSha) {
    fail('GH_TOKEN, GITHUB_REPOSITORY, HEAD_SHA and BASE_SHA are required.');
    return;
  }

  if (event === 'merge_group') {
    const support = mergeGroupSupport({ workflows });
    if (!support.supported) {
      fail(
        `Merge queue is not supported: ${support.reason} Missing merge_group in: ${support.missing
          .map((entry) => entry.path)
          .join(', ')}. Failing closed rather than reporting success with no component runs.`,
      );
      return;
    }

    const changedFiles = await listCompareFiles({
      repo,
      baseSha,
      headSha,
      token,
      config,
      signal,
    });
    const initialPlan = planGate({
      workflows,
      changedFiles,
      baseRef,
      action: 'merge_group',
      selfPath: SELF_PATH,
    });
    if (initialPlan.errors.length > 0) {
      fail(initialPlan.errors.join(' '));
      return;
    }
    const observe = async (signal) => {
      const [runs, statuses] = await Promise.all([
        listRunsAtHead({ repo, headSha, token, event: 'merge_group', config, signal }),
        listStatuses({ repo, headSha, token, config, signal }),
      ]);
      const plan = planGate({
        workflows,
        changedFiles,
        baseRef,
        action: 'merge_group',
        selfPath: SELF_PATH,
        observedRuns: runs,
      });
      return {
        expected: plan.expected,
        runs,
        statuses,
        plan,
        headSha,
        event: 'merge_group',
        repository: repo,
      };
    };
    const result = await runGate({
      observe,
      config,
      gateDeadline,
      log: (line) => console.log(line),
    });
    writeSummary(summarize(result, { headSha, baseRef, event }));
    if (result.decision === 'fail') {
      console.error(`::error title=CI gate::${result.reason}`);
      process.exitCode = 1;
    }
    return;
  }

  if (event !== 'pull_request' || !Number.isFinite(pullNumber) || pullNumber <= 0) {
    fail(
      `Aggregate mode only supports pull_request (or a fully supported merge_group); got ${event}.`,
    );
    return;
  }

  const bootstrap = evaluateBootstrap({
    baseGatePresent,
    authorAssociation,
    trusted,
    bootstrapAuthorized,
  });
  if (!bootstrap.ok) {
    fail(bootstrap.reason);
    return;
  }
  if (bootstrap.bootstrap) {
    console.log(`::warning title=CI gate bootstrap::${bootstrap.reason}`);
  }

  const changedFiles = await listChangedFiles({ repo, pullNumber, token, config, signal });
  const initialPlan = planGate({
    workflows,
    changedFiles,
    baseRef,
    action,
    selfPath: SELF_PATH,
  });
  if (initialPlan.errors.length > 0) {
    fail(initialPlan.errors.join(' '));
    return;
  }
  let guard = { ok: true, required: false, touches: [] };
  const touchesControl = changedFiles.some((file) =>
    GATE_CONTROL_PATHS.some((control) =>
      control.endsWith('/') ? file.startsWith(control) : file === control,
    ),
  );
  if (touchesControl) {
    const reviews = await listReviews({ repo, pullNumber, token, config, signal });
    const owners = parseCodeOwners(
      await readFile(env.GATE_CODEOWNERS ?? new URL('../CODEOWNERS', import.meta.url), 'utf8'),
    );
    guard = evaluateGateChangeGuard({
      changedFiles,
      authorAssociation,
      author,
      reviews,
      owners,
      headSha,
    });
  }
  if (!guard.ok) {
    fail(`CI control guard: ${guard.reason} Touched: ${guard.touches.join(', ')}`);
    return;
  }

  const observe = async (signal) => {
    const [runs, statuses] = await Promise.all([
      listRunsAtHead({ repo, headSha, token, event: 'pull_request', pullNumber, config, signal }),
      listStatuses({ repo, headSha, token, config, signal }),
    ]);
    const plan = planGate({
      workflows,
      changedFiles,
      baseRef,
      action,
      selfPath: SELF_PATH,
      observedRuns: runs,
    });
    if (plan.errors.length > 0) {
      throw new Error(plan.errors.join(' '));
    }
    return {
      expected: plan.expected,
      runs,
      statuses,
      plan,
      headSha,
      event: 'pull_request',
      repository: repo,
      pullNumber,
    };
  };

  const result = await runGate({ observe, config, gateDeadline, log: (line) => console.log(line) });
  writeSummary(summarize(result, { headSha, baseRef, event, bootstrap: bootstrap.bootstrap }));

  if (result.decision === 'fail') {
    console.error(`::error title=CI gate::${result.reason}`);
    process.exitCode = 1;
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  });
}
