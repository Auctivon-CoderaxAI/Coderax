import yaml from 'js-yaml';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const workflow = yaml.load(
  readFileSync(new URL('../workflows/vercel-production.yml', import.meta.url), 'utf8'),
);
const steps = workflow.jobs.deploy.steps;
const deploy = steps.find((step) => step.id === 'deploy');
const verify = steps.find((step) => step.name === 'Verify production alias serves this deployment');
const revision = 'a'.repeat(40);

function runDeploy(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vercel-workflow-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const output = join(dir, 'output');
  const invoked = join(dir, 'invoked');
  writeFileSync(output, '');
  writeFileSync(join(dir, 'git'), '#!/bin/bash\nprintf "%s\\n" "$CHECKOUT_SHA"\n', { mode: 0o700 });
  writeFileSync(join(dir, 'gh'), '#!/bin/bash\nprintf "%s\\n" "$MAIN_SHA"\nexit "$GH_EXIT"\n', {
    mode: 0o700,
  });
  writeFileSync(
    join(dir, 'vercel'),
    '#!/bin/bash\nprintf "called\\n" > "$INVOKED"\nprintf "https://fixture.invalid\\n"\n',
    { mode: 0o700 },
  );
  const result = spawnSync('bash', ['-c', deploy.run], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      GITHUB_REPOSITORY: 'fixture/repo',
      GITHUB_SHA: revision,
      CHECKOUT_SHA: revision,
      MAIN_SHA: revision,
      GH_EXIT: '0',
      GITHUB_OUTPUT: output,
      INVOKED: invoked,
      VERCEL_TOKEN: 'fixture',
      ...overrides,
    },
  });
  let called = false;
  try {
    called = readFileSync(invoked, 'utf8').trim() === 'called';
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { result, output: readFileSync(output, 'utf8'), called };
}

test('only the current checked-out main revision deploys and verifies', (t) => {
  const current = runDeploy(t);
  assert.equal(current.result.status, 0, current.result.stderr);
  assert.equal(current.called, true);
  assert.match(current.output, /deployment_url=https:\/\/fixture\.invalid/);
  assert.doesNotMatch(current.output, /superseded=true/);

  const stale = runDeploy(t, { MAIN_SHA: 'b'.repeat(40) });
  assert.equal(stale.result.status, 0, stale.result.stderr);
  assert.equal(stale.called, false);
  assert.match(stale.output, /superseded=true/);
  assert.equal(verify.if, "steps.deploy.outputs.superseded != 'true'");
});

test('failed or invalid main lookup and mismatched checkout fail closed', (t) => {
  for (const overrides of [
    { GH_EXIT: '1' },
    { MAIN_SHA: '' },
    { MAIN_SHA: 'not-a-sha' },
    { CHECKOUT_SHA: 'b'.repeat(40) },
  ]) {
    const actual = runDeploy(t, overrides);
    assert.notEqual(actual.result.status, 0);
    assert.equal(actual.called, false);
    assert.doesNotMatch(actual.output, /superseded=true/);
  }
});

test('workflow keeps the main guard and installs without the deployment token', () => {
  assert.equal(workflow.jobs.deploy.if, "github.ref == 'refs/heads/main'");
  assert.equal(workflow.permissions.contents, 'read');
  assert.equal(workflow.env.VERCEL_TOKEN, undefined);
  assert.equal(
    steps.find((step) => step.name === 'Install Vercel CLI').env?.VERCEL_TOKEN,
    undefined,
  );
  for (const step of steps.filter((item) => item.run)) {
    const result = spawnSync('bash', ['-n'], { input: step.run, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});
