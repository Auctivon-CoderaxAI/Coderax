#!/usr/bin/env node
/**
 * Verify that a commit's required checks actually executed and passed.
 *
 * A failed GitHub Actions check with no recorded steps did not test the
 * commit: the job never started (runner outage, account billing block, etc.).
 * Treating that as an ordinary code failure is misleading, and treating a
 * preview or health probe as sufficient is how an unverified release ships.
 * This gate fails closed and reports those checks as BLOCKED with the runner's
 * own annotation when GitHub provides one.
 *
 * Usage:
 *   node scripts/verify-release-gate.mjs --sha <commit> --require "Static checks,Backend Unit Tests"
 *   node scripts/verify-release-gate.mjs --sha <commit> --require "Static checks" --json
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GITHUB_ACTIONS_APP = 'github-actions';
const DEFAULT_REPO = 'CoderaxAI/Coderax';

export function parseRequired(value) {
  if (typeof value !== 'string') {
    return [];
  }
  return [
    ...new Set(
      value
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
}

export function classifyCheckRun(check) {
  if (check?.status !== 'completed') {
    return 'pending';
  }
  if (check.conclusion === 'success') {
    return 'pass';
  }
  const executedSteps = Array.isArray(check.steps) ? check.steps.length : null;
  if (check.app?.slug === GITHUB_ACTIONS_APP && executedSteps === 0) {
    return 'blocked';
  }
  return 'fail';
}

function isNewerCheck(check, previous) {
  const runId = Number(check.workflow_run_id) || 0;
  const previousRunId = Number(previous.workflow_run_id) || 0;
  if (runId && previousRunId && runId !== previousRunId) {
    return runId > previousRunId;
  }
  const attempt = Number(check.workflow_run_attempt) || 0;
  const previousAttempt = Number(previous.workflow_run_attempt) || 0;
  if (attempt !== previousAttempt) {
    return attempt > previousAttempt;
  }
  // Check IDs increase with new attempts; completion timestamps can overlap.
  return (Number(check.id) || 0) >= (Number(previous.id) || 0);
}

function checkRunKey(check) {
  const runId = /\/actions\/runs\/(\d+)/.exec(check.details_url ?? '')?.[1];
  // Workflow ID is stable across push/dispatch/reruns. An unknown workflow
  // stays isolated by run ID rather than silently hiding a failed check.
  let workflow = `check:${check.id}`;
  if (check.workflow_id) {
    workflow = `workflow:${check.workflow_id}`;
  } else if (runId) {
    workflow = `run:${runId}`;
  }
  return `${check.name}\0${workflow}`;
}

function latestRequiredCheckRuns(checkRuns, required) {
  const wanted = new Set(required);
  const latest = new Map();
  for (const check of checkRuns) {
    if (!wanted.has(check.name)) {
      continue;
    }
    const key = checkRunKey(check);
    const previous = latest.get(key);
    if (!previous || isNewerCheck(check, previous)) {
      latest.set(key, check);
    }
  }
  const byName = new Map();
  for (const check of latest.values()) {
    const checks = byName.get(check.name) ?? [];
    checks.push(check);
    byName.set(check.name, checks);
  }
  return byName;
}

export function evaluateReleaseGate({ sha, required, checkRuns, annotations = {} }) {
  if (!Array.isArray(checkRuns)) {
    throw new TypeError('checkRuns must be an array');
  }
  if (!Array.isArray(required) || required.length === 0) {
    throw new TypeError('required must contain at least one check name');
  }

  const latestByName = latestRequiredCheckRuns(checkRuns, required);
  const results = required.map((name) => {
    const checks = latestByName.get(name) ?? [];
    if (checks.length === 0) {
      return {
        name,
        status: 'missing',
        detail: 'No check run with this name exists at the commit.',
        conclusion: null,
        url: null,
      };
    }
    const statuses = checks.map((check) => classifyCheckRun(check));
    let status = 'pass';
    if (statuses.includes('fail')) {
      status = 'fail';
    } else if (statuses.includes('blocked')) {
      status = 'blocked';
    } else if (statuses.includes('pending')) {
      status = 'pending';
    }
    const check = checks.find((candidate) => classifyCheckRun(candidate) === status) ?? checks[0];
    let detail;
    if (status === 'pass') {
      detail = 'Executed and passed.';
    } else if (status === 'pending') {
      detail = `Still ${check.status}.`;
    } else if (status === 'blocked') {
      const annotation = (annotations[check.id] ?? []).find(
        (item) => typeof item?.message === 'string' && item.message.trim().length > 0,
      );
      detail =
        annotation?.message ??
        'The job did not execute any steps. Treat this as infrastructure-blocked, not as a code failure.';
    } else {
      detail = `Conclusion: ${check.conclusion ?? 'unknown'}.`;
    }
    if (checks.length > 1) {
      detail += ` (${checks.length} matching checks evaluated.)`;
    }
    return {
      name,
      status,
      detail,
      conclusion: check.conclusion ?? null,
      url: check.html_url ?? null,
    };
  });

  return {
    sha,
    ok: results.every((result) => result.status === 'pass'),
    results,
  };
}

export function parseArgs(argv) {
  const args = {
    repo: DEFAULT_REPO,
    sha: process.env.GITHUB_SHA ?? '',
    required: [],
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--repo') {
      args.repo = argv[++index] ?? '';
    } else if (argument === '--sha') {
      args.sha = argv[++index] ?? '';
    } else if (argument === '--require') {
      args.required = parseRequired(argv[++index] ?? '');
    } else if (argument === '--json') {
      args.json = true;
    } else if (argument === '--help' || argument === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return args;
}

export function formatReleaseGate(gate) {
  const width = Math.max(6, ...gate.results.map((result) => result.status.length));
  const lines = gate.results.map(
    (result) => `${result.status.toUpperCase().padEnd(width)}  ${result.name} — ${result.detail}`,
  );
  const failed = gate.results.filter((result) => result.status !== 'pass').length;
  lines.push('');
  lines.push(
    gate.ok
      ? `Release gate PASSED at ${gate.sha}.`
      : `Release gate FAILED at ${gate.sha}: ${failed} of ${gate.results.length} required checks did not pass.`,
  );
  return lines.join('\n');
}

function runGh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function loadJobSteps(repo, check, exec = runGh) {
  const jobId = /\/actions\/runs\/\d+\/job\/(\d+)/.exec(check.details_url ?? '')?.[1];
  if (!jobId) {
    return undefined;
  }
  try {
    const job = JSON.parse(exec(['api', `repos/${repo}/actions/jobs/${jobId}`]));
    return Array.isArray(job?.steps) ? job.steps : [];
  } catch {
    return undefined;
  }
}

export function loadCheckRuns(repo, sha, exec = runGh) {
  const raw = exec([
    'api',
    '--paginate',
    '--slurp',
    `repos/${repo}/commits/${sha}/check-runs?per_page=100&filter=all`,
  ]);
  const pages = JSON.parse(raw);
  const workflows = new Map();
  return pages
    .flatMap((page) => (Array.isArray(page?.check_runs) ? page.check_runs : []))
    .map((check) => {
      if (check.app?.slug !== GITHUB_ACTIONS_APP) {
        return check;
      }
      const runId = /\/actions\/runs\/(\d+)/.exec(check.details_url ?? '')?.[1];
      if (runId && !workflows.has(runId)) {
        try {
          const run = JSON.parse(exec(['api', `repos/${repo}/actions/runs/${runId}`]));
          workflows.set(runId, {
            id: Number(run.workflow_id) || null,
            attempt: Number(run.run_attempt) || null,
          });
        } catch {
          // Unknown identity must not make an old failure disappear.
          workflows.set(runId, { id: null, attempt: null });
        }
      }
      const workflow = workflows.get(runId) ?? {};
      const enriched = {
        ...check,
        workflow_id: workflow.id,
        workflow_run_id: runId ? Number(runId) : null,
        workflow_run_attempt: workflow.attempt,
      };
      if (check.status !== 'completed' || check.conclusion === 'success') {
        return enriched;
      }
      return { ...enriched, steps: loadJobSteps(repo, check, exec) };
    });
}

export function loadAnnotations(repo, checkId, exec = runGh) {
  try {
    const parsed = JSON.parse(exec(['api', `repos/${repo}/check-runs/${checkId}/annotations`]));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function usage() {
  return [
    'Usage: node scripts/verify-release-gate.mjs --sha <commit> --require "Check A,Check B"',
    '',
    'Options:',
    '  --repo <owner/name>  Repository (default: CoderaxAI/Coderax)',
    '  --sha <commit>       Exact commit to verify (default: GITHUB_SHA)',
    '  --require <names>    Comma-separated required check names',
    '  --json               Print the full result as JSON',
    '  --help               Show this message',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return 0;
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(args.repo)) {
    throw new Error('--repo must be owner/name');
  }
  if (!/^[0-9a-f]{7,40}$/i.test(args.sha)) {
    throw new Error('--sha must be a 7-40 character commit SHA');
  }
  if (args.required.length === 0) {
    throw new Error('--require must name at least one check');
  }

  const checkRuns = loadCheckRuns(args.repo, args.sha);
  const required = new Set(args.required);
  const annotations = {};
  for (const check of checkRuns) {
    if (required.has(check.name) && classifyCheckRun(check) === 'blocked') {
      annotations[check.id] = loadAnnotations(args.repo, check.id);
    }
  }

  const gate = evaluateReleaseGate({
    sha: args.sha,
    required: args.required,
    checkRuns,
    annotations,
  });
  console.log(args.json ? JSON.stringify(gate, null, 2) : formatReleaseGate(gate));
  return gate.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`Release gate verification failed: ${error.message}`);
      process.exitCode = 1;
    });
}
