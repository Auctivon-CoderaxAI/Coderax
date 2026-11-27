#!/usr/bin/env node
/**
 * Acceptance evidence for a pull request; execute in an authorized environment.
 *
 * A hosted check that never reaches a runner proves nothing about the commit.
 * This script supplies additional verification evidence; it does not replace
 * the required exact-head CI checks.
 *
 * One command runs the four gates a merge has to show against the merge base:
 *
 *   1. TypeScript for workspaces affected by committed and working-tree changes
 *   2. The Work Jest suites, after building data-provider
 *   3. `npm run build:api`
 *   4. The full static-check tier for the same scope, with TypeScript left to step 1
 *
 * It then runs any additional focused test command, and prints a Markdown block
 * naming the commit, the base, the working-tree state and every gate's result.
 * That block is the pull request's acceptance artifact.
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

Runs the four gates a merge has to show, in order:
  1. TypeScript for workspaces affected by committed and working-tree changes
  2. Work Jest (packages/api/src/engines/workChat*), after building data-provider
  3. API build (npm run build:api)
  4. Static checks (--full, same scope as step 1, excluding TypeScript)

then each --test command, and prints the acceptance artifact for the pull request.

  --against <ref>    Base to diff from. Defaults to origin/main, then main.
  --test <command>   Additional focused test command, run through the platform
                     shell. Repeatable.
  --manual <text>    What you observed by hand. Repeatable.
  --skip-static      Skip the four built-in gates (for re-running extra tests).
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
  if (value.trim() === '') fail(`${arg} needs a nonblank value`);
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
  return result.status === 0 ? result.stdout.trimEnd() : null;
}

function resolveCommit(ref) {
  return git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
}

function readCheckout() {
  return {
    head: resolveCommit('HEAD'),
    status: git(['status', '--porcelain', '--untracked-files=normal']),
  };
}

const base = options.against ?? (resolveCommit('origin/main') ? 'origin/main' : 'main');
const baseCommit = resolveCommit(base);
if (!baseCommit)
  fail(`base ${base} does not resolve to a commit — fetch it or pass --against <ref>`);

const initial = readCheckout();
const { head } = initial;
if (!head) fail('could not resolve HEAD to a commit');
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']) ?? 'HEAD';
const mergeBase = git(['merge-base', head, baseCommit]);
if (!mergeBase) fail(`could not find a merge base between HEAD and ${base}`);

function describeStatus(status) {
  if (status === null) return 'unknown';
  if (status === '') return 'clean';
  return `dirty (${status.split('\n').length} path(s))`;
}

console.log(`verify · ${branch} @ ${head.slice(0, 12)} · against ${base}`);
console.log(`  merge base ${mergeBase.slice(0, 12)} · node ${process.version}`);
console.log(`  working tree before gates: ${describeStatus(initial.status)}`);

let checkout = initial;
const checkoutWarnings = [];
if (initial.status === null) {
  checkoutWarnings.push('- Warning: Git status was unavailable before the gates.');
} else if (initial.status !== '') {
  checkoutWarnings.push(
    `- Warning: the working tree was dirty before the gates, so \`${head.slice(0, 12)}\` does not identify what was tested.`,
  );
}

function checkCheckoutAfterGate(label) {
  const next = readCheckout();
  const headChanged = next.head !== null && checkout.head !== null && next.head !== checkout.head;
  const statusChanged =
    next.status !== null && checkout.status !== null && next.status !== checkout.status;
  const gate = markdownCode(label);
  if (headChanged || statusChanged) {
    checkoutWarnings.push(
      `- Warning: checkout changed during ${gate}. Gates may have run on different checkout states.`,
    );
  }
  if (next.head === null || next.status === null) {
    checkoutWarnings.push(`- Warning: could not fully verify checkout state after ${gate}.`);
  }
  checkout = next;
}

function secondsSince(started) {
  return Number(process.hrtime.bigint() - started) / 1e9;
}

/**
 * Runs one gate, streaming its output and keeping a copy for the artifact.
 * `shell` runs the command string through the platform shell, which is how a
 * focused test command is expected to be written; `cwd` moves the gate into a
 * workspace.
 */
async function runGate(label, command, args, gateOptions = {}) {
  console.log(`\n▶ ${label}`);
  console.log(`  $ ${command}${args.length > 0 ? ` ${args.join(' ')}` : ''}`);
  const started = process.hrtime.bigint();
  const result = await new Promise((resolveGate) => {
    const child = spawn(command, args, {
      cwd: gateOptions.cwd ?? ROOT,
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
    child.on('error', (error) => {
      console.error(`\nverify: could not start ${command}: ${error.message}`);
      resolveGate({
        ok: false,
        output: `${output}${error.message}`,
        seconds: secondsSince(started),
      });
    });
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('close', (code, signal) => {
      if (signal) console.error(`\nverify: ${label} ended on ${signal}`);
      resolveGate({ ok: code === 0, output, seconds: secondsSince(started) });
    });
  });
  checkCheckoutAfterGate(label);
  return result;
}

function markdownCode(text) {
  const line = text.replace(/\r\n?|\n/g, ' ');
  let width = 1;
  for (const ticks of line.matchAll(/`+/g)) width = Math.max(width, ticks[0].length + 1);
  const fence = '`'.repeat(width);
  return `${fence} ${line} ${fence}`;
}

function tableCommand(command) {
  if (!command.includes('\\|')) return markdownCode(command).replaceAll('|', '\\|');
  // A backslash before a pipe can cancel the table escape. Encode those cells as HTML.
  const escaped = Array.from(command, (char) => `&#${char.codePointAt(0)};`).join('');
  return `<code>${escaped}</code>`;
}

function fencedCommand(command) {
  let width = 3;
  for (const tildes of command.matchAll(/~+/g)) width = Math.max(width, tildes[0].length + 1);
  const fence = '~'.repeat(width);
  return `${fence}sh\n${command}\n${fence}`;
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
  const tail = output.trim().split('\n').filter(Boolean).at(-1);
  return tail ? [`- ${tail.trim()}`] : [];
}

const STATIC_CHECKS = resolve(ROOT, 'scripts/static-checks.mts');
const gates = [];
const summaries = { typecheck: [], workTests: [], static: [] };

if (!options.skipStatic) {
  const staticTarget = [STATIC_CHECKS, '--against', mergeBase, '--include-worktree'];
  // The static runner owns the workspace typecheck. Run that check alone first
  // and leave it out of the full pass below, so no project is compiled twice.
  const typecheck = await runGate('typecheck', process.execPath, [
    ...staticTarget,
    '--only',
    'typecheck',
  ]);
  summaries.typecheck = summarizeStaticChecks(typecheck.output);
  gates.push({ name: 'Typecheck (all workspaces)', ok: typecheck.ok, seconds: typecheck.seconds });

  const workTests = await runGate(
    'Work Jest',
    'npm run build:data-provider && npm exec --workspace @coderax/api -- jest src/engines/workChat --ci --runInBand --coverage=false',
    [],
    { shell: true },
  );
  summaries.workTests = workTests.output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(Test Suites|Tests):/.test(line))
    .map((line) => `- ${line}`);
  gates.push({
    name: 'Work Jest (`src/engines/workChat`, with data-provider build)',
    ok: workTests.ok,
    seconds: workTests.seconds,
  });

  const build = await runGate('API build', 'npm run build:api', [], { shell: true });
  gates.push({ name: 'API build (`npm run build:api`)', ok: build.ok, seconds: build.seconds });

  const staticResult = await runGate('static checks', process.execPath, [
    ...staticTarget,
    '--full',
    '--skip',
    'typecheck',
  ]);
  summaries.static = summarizeStaticChecks(staticResult.output);
  gates.push({
    name: `Static checks (\`--full\`, against \`${mergeBase.slice(0, 12)}\` plus local changes, excluding typecheck)`,
    ok: staticResult.ok,
    seconds: staticResult.seconds,
  });
}

const extraGates = [];
for (const [index, command] of options.tests.entries()) {
  const multiline = /[\r\n]/.test(command);
  const label = `Focused test ${index + 1}`;
  const name = multiline ? label : tableCommand(command);
  const result = await runGate(multiline ? label : `focused test: ${command}`, command, [], {
    shell: true,
  });
  const gate = { name, ok: result.ok, seconds: result.seconds };
  const outcome = gate.ok ? 'PASS' : 'FAIL';
  extraGates.push(
    multiline
      ? [`- ${outcome} ${label} — ${formatSeconds(gate.seconds)}`, '', fencedCommand(command), '']
      : [`- ${outcome} ${markdownCode(command)} — ${formatSeconds(gate.seconds)}`],
  );
  gates.push(gate);
}

if (gates.length === 0) {
  fail('no gates ran — drop --skip-static or pass --test');
}

const passed = gates.every((gate) => gate.ok);
const warnings = [...checkoutWarnings];
if (options.manual.length === 0) warnings.push('- Warning: no manual observation was supplied.');

const artifact = [
  '### Local verification (hosted CI is billing-blocked)',
  '',
  `- Commit before gates: \`${head.slice(0, 12)}\` on \`${branch}\``,
  `- Base: \`${base}\` (merge base \`${mergeBase.slice(0, 12)}\`)`,
  `- Working tree before gates: ${describeStatus(initial.status)}`,
  ...(gates.length > 0
    ? [
        `- Checkout after gates: ${checkout.head?.slice(0, 12) ?? 'unknown'}, working tree ${describeStatus(checkout.status)}`,
      ]
    : []),
  `- Node: \`${process.version}\``,
  `- Generated: \`${new Date().toISOString()}\``,
  '',
  '| Gate | Result | Duration |',
  '| --- | --- | --- |',
  ...gates.map(
    (gate) => `| ${gate.name} | ${gate.ok ? 'PASS' : 'FAIL'} | ${formatSeconds(gate.seconds)} |`,
  ),
  '',
  'Typecheck results:',
  ...(options.skipStatic
    ? ['- skipped (`--skip-static`)']
    : summaries.typecheck.length > 0
      ? summaries.typecheck
      : ['- no checks ran']),
  '',
  'Work Jest:',
  ...(options.skipStatic
    ? ['- skipped (`--skip-static`)']
    : summaries.workTests.length > 0
      ? summaries.workTests
      : ['- no Jest summary line was reported']),
  '',
  'Static-check results:',
  ...(options.skipStatic
    ? ['- skipped (`--skip-static`)']
    : summaries.static.length > 0
      ? summaries.static
      : ['- no checks ran']),
  '',
  'Additional focused tests:',
  ...(extraGates.length === 0 ? ['- none supplied'] : extraGates.flat()),
  '',
  'Manual observation:',
  ...(options.manual.length === 0
    ? ['- none supplied']
    : options.manual.map((text) => `- ${text}`)),
  ...(warnings.length > 0 ? ['', ...warnings] : []),
];

console.log('\n=== PR ACCEPTANCE ARTIFACT — paste the block below into the pull request ===\n');
console.log(artifact.join('\n'));
console.log('\n=== END ACCEPTANCE ARTIFACT ===\n');

if (passed) {
  console.log(`All recorded gates passed (${gates.length}).`);
  process.exitCode = 0;
} else {
  console.error(
    `Recorded gates failed: ${gates
      .filter((gate) => !gate.ok)
      .map((gate) => gate.name)
      .join(', ')}`,
  );
  process.exitCode = 1;
}
