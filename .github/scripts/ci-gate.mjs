#!/usr/bin/env node
/**
 * Aggregate CI gate.
 *
 * Component workflows in this repository are path-filtered, so a pull request
 * that does not touch their paths produces no check run at all. Requiring those
 * workflows individually therefore leaves the pull request permanently pending
 * on an "Expected" check that will never arrive. This gate runs on every pull
 * request and decides from the check runs that actually exist at the exact head
 * SHA: a component that did not run is not a failure, and a component that ran
 * and failed is.
 *
 * The gate is the only required check. It reads check runs and commit statuses,
 * needs no repository secrets, and runs identically for fork pull requests.
 *
 * Usage: node .github/scripts/ci-gate.mjs
 *   GH_TOKEN      token with checks:read and statuses:read
 *   REPO          owner/name
 *   HEAD_SHA      pull request head commit
 *   GATE_ENFORCE  "false" to report only and always exit 0
 */

const GATE_PREFIX = 'CI gate';
const API_ROOT = 'https://api.github.com';
const GATE_JOB_NAME = 'CI gate (aggregate)';

/** Conclusions that must not block a merge. */
export const PASSING_CONCLUSIONS = new Set(['success', 'neutral', 'skipped', 'stale']);

/** Conclusions that block a merge, including a completed run with no recognized conclusion. */
export const FAILING_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'cancelled',
  'action_required',
  'startup_failure',
  'unknown',
]);

export const DEFAULTS = {
  /**
   * Only this app's check runs are aggregated. Preview or deployment services
   * also post checks at the same SHA; their availability must not decide
   * whether a code change can merge.
   */
  appSlug: 'github-actions',
  /** How long to wait for the first component check run to register. */
  registrationMs: 180_000,
  /** Quiet period after the last observed change before the result is final. */
  settleMs: 90_000,
  pollMs: 15_000,
  /** Bounds the workflow: the job itself is capped a few minutes above this. */
  timeoutMs: 90 * 60_000,
};

/**
 * The gate's own check runs are excluded, otherwise it would wait for itself and
 * never complete. Matching by name also covers a re-run's earlier attempt.
 */
export function isGateCheck(run, gatePrefix = GATE_PREFIX) {
  return typeof run?.name === 'string' && run.name.startsWith(gatePrefix);
}

/** Splits a snapshot of check runs into what blocks, what is pending and what passed. */
export function classify(runs, gatePrefix = GATE_PREFIX, appSlug = DEFAULTS.appSlug) {
  const observed = (Array.isArray(runs) ? runs : []).filter((run) => {
    if (isGateCheck(run, gatePrefix)) {
      return false;
    }
    // A check run without app metadata is kept: dropping an unlabeled failure
    // would turn an unreadable payload into a pass.
    const slug = run?.app?.slug;
    return !slug || !appSlug || slug === appSlug;
  });
  const pending = [];
  const failing = [];
  const passing = [];

  for (const run of observed) {
    if (run.status !== 'completed') {
      pending.push(run);
      continue;
    }
    const conclusion =
      typeof run.conclusion === 'string' && run.conclusion.length > 0 ? run.conclusion : 'unknown';
    if (PASSING_CONCLUSIONS.has(conclusion)) {
      passing.push(run);
      continue;
    }
    failing.push({ ...run, conclusion });
  }

  return { observed, pending, failing, passing };
}

/** Commit statuses are the non-Actions half of "required checks"; both must pass. */
export function classifyStatuses(statuses) {
  const observed = Array.isArray(statuses) ? statuses : [];
  return {
    failing: observed.filter((status) => status.state === 'failure' || status.state === 'error'),
    pending: observed.filter((status) => status.state === 'pending'),
  };
}

function signature(runs, statuses) {
  const runIds = runs.map((run) => `${run.id}:${run.status}:${run.conclusion ?? ''}`).sort();
  const statusIds = statuses
    .map((status) => `${status.context}:${status.state}:${status.updated_at ?? ''}`)
    .sort();
  return [...runIds, '--', ...statusIds].join('|');
}

/**
 * Pure decision function over one observation.
 *
 * Returns `{ decision: 'pass' | 'fail' | 'wait', reason, counts }`. Waiting is
 * only ever returned for a component that can still change or has not
 * registered yet, so the gate cannot hang on a workflow that never runs.
 */
export function evaluate(snapshot) {
  const {
    runs = [],
    statuses = [],
    now,
    startedAt,
    lastChangeAt,
    previousSignature,
    config = DEFAULTS,
    gatePrefix = GATE_PREFIX,
    appSlug = config.appSlug ?? DEFAULTS.appSlug,
  } = snapshot;

  const checks = classify(runs, gatePrefix, appSlug);
  const status = classifyStatuses(statuses);
  const currentSignature = signature(checks.observed, statuses);
  const changed = previousSignature !== undefined && previousSignature !== currentSignature;
  const effectiveLastChange = changed ? now : (lastChangeAt ?? startedAt);
  const counts = {
    observed: checks.observed.length,
    pending: checks.pending.length + status.pending.length,
    failing: checks.failing.length + status.failing.length,
    passing: checks.passing.length,
  };

  if (checks.failing.length > 0) {
    return {
      decision: 'fail',
      reason: `Failed checks: ${checks.failing.map((run) => `${run.name} (${run.conclusion})`).join(', ')}`,
      counts,
      signature: currentSignature,
      lastChangeAt: effectiveLastChange,
    };
  }

  if (status.failing.length > 0) {
    return {
      decision: 'fail',
      reason: `Failed commit statuses: ${status.failing.map((entry) => entry.context).join(', ')}`,
      counts,
      signature: currentSignature,
      lastChangeAt: effectiveLastChange,
    };
  }

  // The budget is checked before "still pending", otherwise a check that never
  // completes would return "wait" forever and the gate could never fail.
  if (now - startedAt >= config.timeoutMs) {
    return {
      decision: 'fail',
      reason: `Timed out after ${Math.round((now - startedAt) / 60_000)} minutes with ${counts.pending} check(s) outstanding.`,
      counts,
      signature: currentSignature,
      lastChangeAt: effectiveLastChange,
    };
  }

  if (checks.pending.length > 0) {
    return {
      decision: 'wait',
      reason: `Waiting on: ${checks.pending.map((run) => run.name).join(', ')}`,
      counts,
      signature: currentSignature,
      lastChangeAt: effectiveLastChange,
    };
  }

  if (status.pending.length > 0) {
    return {
      decision: 'wait',
      reason: `Waiting on commit statuses: ${status.pending.map((entry) => entry.context).join(', ')}`,
      counts,
      signature: currentSignature,
      lastChangeAt: effectiveLastChange,
    };
  }

  if (checks.observed.length === 0 && now - startedAt < config.registrationMs) {
    return {
      decision: 'wait',
      reason:
        'No component check has registered yet; path filters may have excluded every workflow.',
      counts,
      signature: currentSignature,
      lastChangeAt: effectiveLastChange,
    };
  }

  if (now - effectiveLastChange < config.settleMs) {
    return {
      decision: 'wait',
      reason: 'Every observed check has completed; letting late registrations settle.',
      counts,
      signature: currentSignature,
      lastChangeAt: effectiveLastChange,
    };
  }

  return {
    decision: 'pass',
    reason:
      checks.observed.length === 0
        ? 'No component workflow applied to this change; nothing to wait for.'
        : `All ${checks.observed.length} observed check(s) completed without failure.`,
    counts,
    signature: currentSignature,
    lastChangeAt: effectiveLastChange,
  };
}

function headers(token) {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'coderax-ci-gate',
  };
}

async function getResponse(url, token, signal) {
  const response = await fetch(url, { headers: headers(token), signal });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return response;
}

async function collectCheckRuns(repo, sha, token, signal) {
  const runs = [];
  for (let page = 1; page <= 10; page += 1) {
    const response = await getResponse(
      `${API_ROOT}/repos/${repo}/commits/${sha}/check-runs?filter=latest&per_page=100&page=${page}`,
      token,
      signal,
    );
    const body = await response.json();
    const batch = body.check_runs;
    if (!Array.isArray(batch)) {
      throw new Error('Invalid check runs response.');
    }
    runs.push(...batch);
    if (batch.length < 100 || runs.length >= (body?.total_count ?? 0)) {
      break;
    }
  }
  return runs;
}

async function collectStatuses(repo, sha, token, signal) {
  const statuses = [];
  for (let page = 1; ; page += 1) {
    const response = await getResponse(
      `${API_ROOT}/repos/${repo}/commits/${sha}/status?per_page=100&page=${page}`,
      token,
      signal,
    );
    const body = await response.json();
    if (!Array.isArray(body.statuses)) {
      throw new Error('Invalid commit statuses response.');
    }
    statuses.push(...body.statuses);
    if (!response.headers.get('link')?.includes('rel="next"')) {
      return statuses;
    }
  }
}

function summarize(result) {
  const { decision, reason, counts } = result;
  const icon = decision === 'pass' ? '✅' : decision === 'fail' ? '❌' : '⏳';
  return [
    `### ${icon} ${GATE_JOB_NAME}`,
    '',
    `| observed | passing | failing | pending |`,
    `|---|---|---|---|`,
    `| ${counts.observed} | ${counts.passing} | ${counts.failing} | ${counts.pending} |`,
    '',
    reason,
  ].join('\n');
}

async function main() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const repo = process.env.REPO || process.env.GITHUB_REPOSITORY;
  const sha = process.env.HEAD_SHA;
  const enforce = process.env.GATE_ENFORCE !== 'false';
  const pollMs = Number(process.env.GATE_POLL_MS || DEFAULTS.pollMs);
  const config = {
    ...DEFAULTS,
    registrationMs: Number(process.env.GATE_REGISTRATION_MS || DEFAULTS.registrationMs),
    settleMs: Number(process.env.GATE_SETTLE_MS || DEFAULTS.settleMs),
    timeoutMs: Number(process.env.GATE_TIMEOUT_MS || DEFAULTS.timeoutMs),
  };

  if (!token || !repo || !sha) {
    console.error('GH_TOKEN, REPO and HEAD_SHA are required.');
    process.exit(2);
  }

  const startedAt = Date.now();
  let lastChangeAt = startedAt;
  let previousSignature;
  let result;

  for (;;) {
    try {
      const remainingMs = Math.max(1, config.timeoutMs - (Date.now() - startedAt));
      const signal = AbortSignal.timeout(remainingMs);
      const [runs, statuses] = await Promise.all([
        collectCheckRuns(repo, sha, token, signal),
        collectStatuses(repo, sha, token, signal),
      ]);
      const now = Date.now();
      result = evaluate({
        runs,
        statuses,
        now,
        startedAt,
        lastChangeAt,
        previousSignature,
        config,
      });
      previousSignature = result.signature;
      lastChangeAt = result.lastChangeAt;
      console.log(`[${new Date(now).toISOString()}] ${result.decision}: ${result.reason}`);
      if (result.decision !== 'wait') {
        break;
      }
    } catch (error) {
      console.log(`::warning title=CI gate::Could not read checks: ${error.message}`);
      lastChangeAt = Date.now();
      if (lastChangeAt - startedAt >= config.timeoutMs) {
        result = {
          decision: 'fail',
          reason: 'Timed out without a complete snapshot of check runs and commit statuses.',
          counts: result?.counts ?? { observed: 0, passing: 0, failing: 0, pending: 0 },
        };
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  const summary = summarize(result);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }

  if (result.decision === 'fail' && enforce) {
    console.log(`::error title=CI gate::${result.reason}`);
    process.exit(1);
  }
  if (result.decision === 'fail') {
    console.log(`::warning title=CI gate::${result.reason}`);
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'));

if (invokedDirectly) {
  await main();
}
