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
 * `options.shell` runs the string through the platform shell, which is how a
 * focused test command is expected to be written.
 */
async function runGate(label, command, args, gateOptions = {}) {
  console.log(`\n▶ ${label}`);
  console.log(`  $ ${command}${args.length > 0 ? ` ${args.join(' ')}` : ''}`);
  const started = process.hrtime.bigint();
  const result = await new Promise((resolveGate) => {
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
  const escaped = Array.from(
    command.replace(/\r\n?|\n/g, ' '),
    (char) => `&#${char.codePointAt(0)};`,
  ).join('');
  return `<code>${escaped}</code>`;
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

const gates = [];
let staticDetails = ['- skipped (`--skip-static`)'];

const staticResult = options.skipStatic
  ? null
  : await runGate('static checks (full)', process.execPath, [
      resolve(ROOT, 'scripts/static-checks.mts'),
      '--against',
      mergeBase,
      '--full',
    ]);

if (staticResult) {
  staticDetails = summarizeStaticChecks(staticResult.output);
  if (staticDetails.length === 0) staticDetails = ['- no checks ran'];
  gates.push({
    name: `Static checks (\`--full\`, against \`${mergeBase.slice(0, 12)}\`)`,
    ok: staticResult.ok,
    seconds: staticResult.seconds,
  });
}

for (const command of options.tests) {
  const result = await runGate(`focused test: ${command}`, command, [], { shell: true });
  gates.push({ name: tableCommand(command), ok: result.ok, seconds: result.seconds });
}

const passed = gates.every((gate) => gate.ok);
const warnings = [...checkoutWarnings];
if (options.tests.length === 0) warnings.push('- Warning: no focused test command was supplied.');
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
  'Static-check results:',
  ...staticDetails,
  '',
  'Focused tests:',
  ...(options.tests.length === 0
    ? ['- none supplied']
    : options.tests.map((command, index) => {
        const gate = gates[(staticResult ? 1 : 0) + index];
        return `- ${gate.ok ? 'PASS' : 'FAIL'} ${markdownCode(command)} — ${formatSeconds(gate.seconds)}`;
      })),
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
