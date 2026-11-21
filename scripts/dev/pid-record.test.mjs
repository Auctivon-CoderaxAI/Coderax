import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';

import { groupState, ownerKey } from './pid-record.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startGroup(token) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, [ownerKey]: token },
  });
  await once(child, 'spawn');
  return child;
}

async function stopGroup(child) {
  if (child.exitCode != null || child.signalCode != null) {
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') {
      throw error;
    }
  }
  await once(child, 'exit');
}

async function waitForState(record, expected, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let state;
  while (Date.now() < deadline) {
    state = groupState(record);
    if (state === expected) {
      return state;
    }
    await sleep(25);
  }
  return state;
}

test('a group carrying the recorded marker is verified', async () => {
  const token = randomUUID();
  const child = await startGroup(token);
  try {
    assert.equal(await waitForState({ pid: child.pid, token }, 'owned'), 'owned');
  } finally {
    await stopGroup(child);
  }
});

test('a live group carrying another marker is mismatched', async () => {
  const child = await startGroup(randomUUID());
  try {
    assert.equal(groupState({ pid: child.pid, token: randomUUID() }), 'unverified');
  } finally {
    await stopGroup(child);
  }
});

test('a live legacy record without a marker is unverifiable', async () => {
  const child = await startGroup(randomUUID());
  try {
    assert.equal(groupState({ pid: child.pid }), 'unverified');
  } finally {
    await stopGroup(child);
  }
});

test('a record whose group is gone is stale', async () => {
  const token = randomUUID();
  const child = await startGroup(token);
  const record = { pid: child.pid, token };
  await stopGroup(child);
  assert.equal(await waitForState(record, 'gone'), 'gone');
});

test('a legacy record whose process is gone is stale', async () => {
  const child = await startGroup(randomUUID());
  const pid = child.pid;
  await stopGroup(child);
  assert.equal(await waitForState({ pid }, 'gone'), 'gone');
});
