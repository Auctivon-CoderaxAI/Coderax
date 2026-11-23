/**
 * Ownership checks for the process groups `dev:up` starts.
 *
 * Every service carries a per-run marker in its environment and its PID record
 * stores the marker. A recycled PID or an unrelated process therefore never
 * passes as the group the stack started.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

export const ownerKey = 'CODERAX_DEV_GROUP_OWNER';

export function hasToken(pid, token) {
  const marker = `${ownerKey}=${token}`;
  if (process.platform === 'linux') {
    try {
      return fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').includes(marker);
    } catch (error) {
      if (['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) {
        return false;
      }
      throw error;
    }
  }
  // BSD ps can display the initial environment for same-user processes.
  try {
    return execFileSync('ps', ['eww', '-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
    })
      .trim()
      .split(/\s+/)
      .includes(marker);
  } catch (error) {
    if (error.status === 1) {
      return false;
    }
    throw error;
  }
}

export function groupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') {
      return false;
    }
    if (error.code === 'EPERM') {
      return true;
    }
    throw error;
  }
}

/**
 * Classify a recorded group:
 *
 * - owned: a live member of the group carries the recorded marker
 * - unverified: the group is alive but ownership cannot be proven, so it must
 *   not be signaled
 * - gone: the group is gone (or only zombies remain), so its record is stale
 */
export function groupState({ pid, token }) {
  if (!groupAlive(pid)) {
    return 'gone';
  }
  if (!token) {
    return 'unverified';
  }
  const rows = execFileSync('ps', ['-ax', '-o', 'pid=', '-o', 'pgid=', '-o', 'stat='], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n');
  let sawMember = false;
  let sawLiveMember = false;
  for (const row of rows) {
    const [member, group, state] = row.trim().split(/\s+/);
    if (Number(group) !== pid) {
      continue;
    }
    sawMember = true;
    if (state?.startsWith('Z')) {
      continue;
    }
    sawLiveMember = true;
    if (hasToken(Number(member), token)) {
      return 'owned';
    }
  }
  // A zombie cannot serve traffic or react to signals. An invisible live group,
  // however, may still own a service; keep its record until it can be verified.
  if (sawMember && !sawLiveMember) {
    return 'gone';
  }
  return groupAlive(pid) ? 'unverified' : 'gone';
}

export async function waitForGroupExit(readState, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (readState() === 'gone') {
      return true;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return false;
    }
    await sleep(Math.min(250, remaining));
  }
}
