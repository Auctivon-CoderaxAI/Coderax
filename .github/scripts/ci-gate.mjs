#!/usr/bin/env node
/**
 * Always-on aggregate CI gate.
 *
 * Most lanes in this repository are path-filtered, so a pull request that
 * touches only `client/**` never starts the backend workflows at all. A
 * required status check cannot express that: a workflow that is never
 * triggered leaves its check absent, and an absent required check blocks a
 * merge forever. The workaround people reach for — making nothing required —
 * lets a change merge with no evidence at all.
 *
 * This gate is the one check branch protection should require. It always runs,
 * reads the required lanes from `.github/required-checks.json`, and decides
 * per lane:
 *
 *   - the check reported success            -> pass
 *   - the check reported failure/cancelled  -> fail
 *   - the check reported skipped            -> fail: nothing was verified
 *   - the check never appeared, and its
 *     workflow produced no run at this head -> pass, but only when the
 *     manifest says that workflow is path-filtered and the settle window has
 *     elapsed, so the workflow could have started
 *   - the check never appeared although its
 *     workflow did run                       -> fail
 *
 * Presence is decided from GitHub's own evaluation of each workflow's
 * `paths:` filter, never from a second copy of those filters that could drift.
 * The manifest self-check in `ci-gate.test.mjs` keeps the `pathFiltered` claims
 * honest by reading the workflows it names.
 */
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

/** Conclusions that mean the lane actually verified something. */
const PASSING = new Set(['success', 'neutral']);
/** A lane that completed without running is not evidence of anything. */
const NOT_RUN = new Set(['skipped']);

const POLL_MS = Number(process.env.CI_GATE_POLL_MS ?? 20_000);
const DEADLINE_MS = Number(process.env.CI_GATE_DEADLINE_MS ?? 40 * 60_000);
const SETTLE_MS = Number(process.env.CI_GATE_SETTLE_SECONDS ?? 120) * 1000;

export function loadManifest(root) {
  const raw = readFileSync(`${root}/.github/required-checks.json`, 'utf8');
  return JSON.parse(raw);
}

/**
 * Decide the gate from one observation of the head.
 *
 * `runs` is the set of workflow runs GitHub created for this head at all,
 * keyed by the workflow file name in `.github/workflows/`. `checks` is every
 * check run reported for this head. `settled` says whether enough time has
 * passed that a path-filtered workflow would already have appeared.
 */
export function evaluate({ manifest, checks, runs, settled }) {
  const required = [];
  const reportOnly = [];

  const judge = (lane) => {
    const patterns = lane.patterns ?? [lane.name];
    const findings = [];

    // A lane may be declared before its workflow merges. Until the workflow is
    // on the branch this gate runs from, there is nothing to enforce.
    if (lane.optional && lane.present === false) {
      return {
        ...lane,
        findings: [
          { pattern: lane.workflow, state: 'filtered', detail: 'workflow is not on main yet' },
        ],
      };
    }

    for (const pattern of patterns) {
      const matches = checks.filter((check) => check.name.startsWith(pattern));
      if (matches.length === 0) {
        const ownerRan = (runs[lane.workflow] ?? 0) > 0;
        if (ownerRan) {
          findings.push({
            pattern,
            state: 'missing',
            detail: `${lane.workflow} ran at this head but never reported a check named "${pattern}"`,
          });
        } else if (!lane.pathFiltered) {
          findings.push({
            pattern,
            state: 'missing',
            detail: `${lane.workflow} declares no path filter, so "${pattern}" must always report`,
          });
        } else if (!settled) {
          findings.push({
            pattern,
            state: 'pending',
            detail: `${lane.workflow} has not started yet`,
          });
        } else {
          findings.push({
            pattern,
            state: 'filtered',
            detail: `${lane.workflow} was not triggered by this diff`,
          });
        }
        continue;
      }

      const running = matches.filter((check) => check.status !== 'completed');
      if (running.length > 0) {
        findings.push({
          pattern,
          state: 'pending',
          detail: `${running.map((check) => check.name).join(', ')} still running`,
        });
        continue;
      }

      const notRun = matches.filter((check) => NOT_RUN.has(check.conclusion));
      const failed = matches.filter(
        (check) => !PASSING.has(check.conclusion) && !NOT_RUN.has(check.conclusion),
      );

      if (notRun.length > 0) {
        findings.push({
          pattern,
          state: 'skipped',
          detail: `${notRun.map((check) => check.name).join(', ')} skipped, so nothing was verified`,
        });
      } else if (failed.length > 0) {
        findings.push({
          pattern,
          state: 'failed',
          detail: failed.map((check) => `${check.name} (${check.conclusion})`).join(', '),
        });
      } else {
        findings.push({ pattern, state: 'passed', detail: '' });
      }
    }

    return { ...lane, findings };
  };

  for (const lane of manifest.required) {
    required.push(judge(lane));
  }
  for (const lane of manifest.reportOnly ?? []) {
    reportOnly.push(judge(lane));
  }

  const pending = required.some((lane) =>
    lane.findings.some((finding) => finding.state === 'pending'),
  );
  const failures = required.flatMap((lane) =>
    lane.findings
      .filter((finding) => ['failed', 'skipped', 'missing'].includes(finding.state))
      .map((finding) => ({ workflow: lane.workflow, ...finding })),
  );

  const notable = reportOnly.flatMap((lane) =>
    lane.findings
      .filter((finding) => finding.state !== 'passed' && finding.state !== 'filtered')
      .map((finding) => ({ workflow: lane.workflow, reason: lane.reason, ...finding })),
  );
  return { required, reportOnly, pending, failures, notable };
}

export function render({ required, reportOnly, failures, notable, settled }) {
  const lines = ['### CI gate', ''];

  lines.push('| Lane | Workflow | Result | Note |', '| --- | --- | --- | --- |');
  for (const lane of required) {
    const state = lane.findings.some((finding) => finding.state === 'pending')
      ? 'running'
      : lane.findings.some((finding) => ['failed', 'skipped', 'missing'].includes(finding.state))
        ? 'fail'
        : lane.findings.every((finding) => finding.state === 'filtered')
          ? 'not triggered'
          : 'pass';
    const note = lane.findings
      .filter((finding) => finding.state !== 'passed' && finding.state !== 'filtered')
      .map((finding) => finding.detail)
      .join('; ');
    lines.push(`| ${lane.label} | \`${lane.workflow}\` | ${state} | ${note} |`);
  }

  if (reportOnly.length > 0) {
    lines.push('', '<details><summary>Report-only lanes (not enforced yet)</summary>', '');
    lines.push(
      '| Lane | Workflow | Result | Why it is not enforced |',
      '| --- | --- | --- | --- |',
    );
    for (const lane of reportOnly) {
      const states = lane.findings.map((finding) => finding.state).join(', ');
      lines.push(`| ${lane.label} | \`${lane.workflow}\` | ${states} | ${lane.reason} |`);
    }
    lines.push('', '</details>');
  }

  if (failures.length > 0) {
    lines.push('', '**Failures**', '');
    for (const failure of failures) {
      lines.push(`- \`${failure.workflow}\` · ${failure.pattern}: ${failure.detail}`);
    }
  }

  if (!settled) {
    lines.push(
      '',
      '_The settle window has not elapsed; absent path-filtered lanes are still pending._',
    );
  }

  if (notable.length > 0) {
    lines.push('', '**Report-only findings**', '');
    for (const item of notable) {
      lines.push(`- \`${item.workflow}\` · ${item.pattern}: ${item.detail}`);
    }
  }

  return lines.join('\n');
}

async function api(path, token) {
  const response = await fetch(`${process.env.GITHUB_API_URL ?? 'https://api.github.com'}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(
      `${path} answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  }
  return response.json();
}

async function collect(repo, sha, token) {
  const checks = [];
  for (let page = 1; ; page += 1) {
    const body = await api(
      `/repos/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}`,
      token,
    );
    checks.push(
      ...body.check_runs.map((run) => ({
        name: run.name,
        status: run.status,
        conclusion: run.conclusion,
      })),
    );
    if (body.check_runs.length < 100) break;
  }

  const runs = {};
  for (let page = 1; page <= 5; page += 1) {
    const body = await api(
      `/repos/${repo}/actions/runs?head_sha=${sha}&event=pull_request&per_page=100&page=${page}`,
      token,
    );
    for (const run of body.workflow_runs) {
      runs[run.path.replace('.github/workflows/', '')] =
        (runs[run.path.replace('.github/workflows/', '')] ?? 0) + 1;
    }
    if (body.workflow_runs.length < 100) break;
  }

  return { checks, runs };
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.REPO;
  const sha = process.env.HEAD_SHA;
  if (!token || !repo || !sha) {
    throw new Error('GITHUB_TOKEN, REPO and HEAD_SHA are required');
  }

  const { readdirSync } = await import('node:fs');
  const present = new Set(readdirSync(`${process.cwd()}/.github/workflows`));
  const manifest = loadManifest(process.cwd());
  for (const lane of [...manifest.required, ...(manifest.reportOnly ?? [])]) {
    lane.present = present.has(lane.workflow);
  }
  const startedAt = Date.now();
  let last = null;

  for (;;) {
    const { checks, runs } = await collect(repo, sha, token);
    const settled = Date.now() - startedAt >= SETTLE_MS;
    last = evaluate({ manifest, checks, runs, settled });

    if (!last.pending) break;
    if (Date.now() - startedAt >= DEADLINE_MS) break;
    console.log(`gate: ${last.required.length} lanes, waiting on ${summarisePending(last)}`);
    await sleep(POLL_MS);
  }

  const body = render(last);
  console.log(body);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`);
  }

  if (last.pending) {
    console.error('CI gate: timed out waiting for required lanes');
    process.exit(1);
  }
  if (last.failures.length > 0) {
    console.error(`CI gate: ${last.failures.length} required lane(s) did not pass`);
    process.exit(1);
  }
  console.log('CI gate: every required lane passed or was not triggered by this diff');
}

function summarisePending(state) {
  return state.required
    .flatMap((lane) => lane.findings.filter((finding) => finding.state === 'pending'))
    .map((finding) => finding.pattern)
    .join(', ');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`CI gate: ${error.message}`);
    process.exit(1);
  });
}
