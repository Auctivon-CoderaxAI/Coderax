#!/usr/bin/env node
/**
 * Local acceptance gate for a change that cannot rely on hosted CI.
 *
 * This repository's GitHub Actions runs are blocked at the account billing
 * layer: a failing check never reaches a runner, so it proves nothing about the
 * commit. Until that is resolved, the evidence a reviewer gets is this script's
 * output, pasted into the pull request.
 *
 * It runs the full static-check tier (ESLint, Prettier, import order, circular
 * dependencies, TypeScript, config tests, i18n, dependency scan) against the
 * merge base, then each focused test command supplied on the command line, and
 * prints a Markdown block naming the commit, the base and every gate's result.
 *
 * Usage:
 *   npm run verify -- --against origin/main \
 *     --test "cd packages/api && npx jest src/engines/workChat.spec.ts --ci" \
 *     --manual "Sent one Work message; the stream rendered and the transcript survived reload."
 *
 * Flags:
 *   --against <ref>    Base to diff from. Defaults to origin/main, then main.
 *   --test <command>   Focused test command, run through the platform shell.
 *                      Repeatable.
 *   --manual <text>    What you observed by hand. Repeatable.
 *   --skip-static      Skip the static-check tier (for re-running tests only).
 *   --help             Show this text.
 *
 * At least one --test or --manual is required: an artifact that records neither
 * is not evidence of anything.
 */
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

const USAGE = `Usage: npm run verify -- [--against <ref>] [--test <command>]... [--manual <text>]... [--skip-static]

  --against <ref>    Base to diff from. Defaults to origin/main, then main.
  --test <command>   Focused test command, run through the platform shell.
                     Repeatable.
  --manual <text>    What you observed by hand. Repeatable.
  --skip-static      Skip the static-check tier (for re-running tests only).
  --help             Show this text.`;

const VALUED = new Set(['--against', '--test', '--manual']);
const BOOLEAN = new Set(['--skip-static', '--help', '-h']);

const options = { against: undefined, tests: [], manual: [], skipStatic: false, help: false };

for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (BOOLEAN.has(arg)) {
    if (arg === '--skip-static') options.skipStatic = true;
    else options.help = true;
    continue;
  }
  if (!VALUED.has(arg)) fail(`unknown argument ${arg}`);
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) fail(`${arg} needs a value`);
  index += 1;
  if (arg === '--against') {
    if (options.against !== undefined) fail('--against can only be given once');
    options.against = value;
  } else if (arg === '--test') {
    options.tests.push(value);
  } else {
    options.manual.push(value);
  }
}

function fail(message) {
  console.error(`verify: ${message}\n\n${USAGE}`);
  process.exit(2);
}

if (options.help) {
  console.log(USAGE);
  process.exit(0);
}

if (options.tests.length === 0 && options.manual.length === 0) {
  fail('nothing to record — pass at least one --test or --manual');
}

function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

const requestedBase = options.against;
const base =
  requestedBase ??
  (git(['rev-parse', '--verify', 'origin/main']) ? 'origin/main' : 'main');

if (!git(['rev-parse', '--verify', base])) {
  fail(`base ${base} does not resolve — fetch it or pass --against <ref>`);
}

const head = git(['rev-parse', 'HEAD']) ?? 'unknown';
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']) ?? 'HEAD';
const mergeBase = git(['merge-base', 'HEAD', base]) ?? base;
const dirty = (git(['status', '--porcelain', '--untracked-files=normal']) ?? '')
  .split('\n')
  .filter(Boolean);

console.log(`verify · ${branch} @ ${head.slice(0, 12)} · against ${base}`);
console.log(`  merge base ${mergeBase.slice(0, 12)} · node ${process.version}`);
if (dirty.length > 0) {
  console.log(`  working tree is dirty (${dirty.length} path(s)) — commit before treating this as evidence`);
}

function secondsSince(started) {
  return Number(process.hrtime.bigint() - started) / 1e9;
}

/**
 * Runs one gate, streaming its output and keeping a copy for the artifact.
 * `options.shell` runs the string through the platform shell, which is how a
 * focused test command is expected to be written.
 */
function runGate(label, command, args, gateOptions = {}) {
  console.log(`\n▶ ${label}`);
  console.log(`  $ ${command}${args.length > 0 ? ` ${args.join(' ')}` : ''}`);
  const started = process.hrtime.bigint();
  return new Promise((resolveGate) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: process.env,
      shell: gateOptions.shell === true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const onData = (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (error) => {
      console.error(`\nverify: could not start ${command}: ${error.message}`);
      resolveGate({
        ok: false,
        output: `${output}${error.message}`,
        seconds: secondsSince(started),
      });
    });
    child.on('close', (code, signal) => {
      if (signal) console.error(`\nverify: ${label} ended on ${signal}`);
      resolveGate({ ok: code === 0, output, seconds: secondsSince(started) });
    });
  });
}

function oneLine(text) {
  return text.replace(/`/g, "'").replace(/\s*\n\s*/g, ' ');
}

function formatSeconds(seconds) {
  return `${seconds.toFixed(1)}s`;
}

/** The per-check lines static-checks prints, restated as Markdown bullets. */
function summarizeStaticChecks(output) {
  const checks = [];
  for (const line of output.split('\n')) {
    const match = /^ {2}([✓✗–]) (.+?)\s{2,}(.+)$/.exec(line);
    if (match) checks.push(`- ${match[1]} ${match[2]} — ${match[3]}`);
  }
  if (checks.length > 0) return checks;
  const tail = output
    .trim()
    .split('\n')
    .filter(Boolean)
    .at(-1);
  return tail ? [`- ${tail.trim()}`] : [];
}

const gates = [];

const staticResult = options.skipStatic
  ? null
  : await runGate('static checks (full)', process.execPath, [
      resolve(ROOT, 'scripts/static-checks.mts'),
      '--against',
      base,
      '--full',
    ]);

if (staticResult) {
  gates.push({
    name: `Static checks (\`--full\`, against \`${base}\`)`,
    ok: staticResult.ok,
    seconds: staticResult.seconds,
    detail: summarizeStaticChecks(staticResult.output),
  });
}

for (const command of options.tests) {
  const result = await runGate(`focused test: ${command}`, command, [], { shell: true });
  gates.push({ name: `\`${oneLine(command)}\``, ok: result.ok, seconds: result.seconds });
}

const passed = gates.every((gate) => gate.ok);
const warnings = [];
if (dirty.length > 0) {
  warnings.push(
    `- Warning: the working tree is dirty, so \`${head.slice(0, 12)}\` does not identify what was tested.`,
  );
}
if (options.tests.length === 0) warnings.push('- Warning: no focused test command was supplied.');
if (options.manual.length === 0) warnings.push('- Warning: no manual observation was supplied.');

const artifact = [
  '### Local verification (hosted CI is billing-blocked)',
  '',
  `- Commit: \`${head.slice(0, 12)}\` on \`${branch}\``,
  `- Base: \`${base}\` (merge base \`${mergeBase.slice(0, 12)}\`)`,
  `- Working tree: ${dirty.length === 0 ? 'clean' : `dirty (${dirty.length} path(s))`}`,
  `- Node: \`${process.version}\``,
  `- Generated: \`${new Date().toISOString()}\``,
  '',
  '| Gate | Result | Duration |',
  '| --- | --- | --- |',
  ...gates.map(
    (gate) => `| ${gate.name} | ${gate.ok ? 'PASS' : 'FAIL'} | ${formatSeconds(gate.seconds)} |`,
  ),
  '',
  'Static-check results:',
  ...(staticResult === null
    ? ['- skipped (`--skip-static`)']
    : (gates[0].detail.length > 0 ? gates[0].detail : ['- no checks ran'])),
  '',
  'Focused tests:',
  ...(options.tests.length === 0
    ? ['- none supplied']
    : options.tests.map((command, index) => {
        const gate = gates[(staticResult ? 1 : 0) + index];
        return `- ${gate.ok ? 'PASS' : 'FAIL'} \`${oneLine(command)}\` — ${formatSeconds(gate.seconds)}`;
      })),
  '',
  'Manual observation:',
  ...(options.manual.length === 0 ? ['- none supplied'] : options.manual.map((text) => `- ${text}`)),
  ...(warnings.length > 0 ? ['', ...warnings] : []),
];

console.log('\n=== PR ACCEPTANCE ARTIFACT — paste the block below into the pull request ===\n');
console.log(artifact.join('\n'));
console.log('\n=== END ACCEPTANCE ARTIFACT ===\n');

if (passed) {
  console.log(`All recorded gates passed (${gates.length}).`);
  process.exitCode = 0;
} else {
  console.error(`Recorded gates failed: ${gates.filter((gate) => !gate.ok).map((gate) => gate.name).join(', ')}`);
  process.exitCode = 1;
}
