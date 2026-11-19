import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { User } from '../types';

export interface E2ECredentials {
  primary: User;
  secondary: User;
  emailChange: User;
  emailChangeTarget: string;
}

const credentialsPath = path.resolve(__dirname, '../.generated/credentials.json');
let cached: E2ECredentials | null = null;

export function randomPassword(): string {
  return crypto.randomBytes(24).toString('hex');
}

function randomEmail(prefix: string, runId: string): string {
  return `${prefix}-${runId}@example.com`;
}

function isUser(value: unknown): value is User {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const user = value as User;
  return [user.email, user.name, user.password].every(
    (field) => typeof field === 'string' && field.length > 0,
  );
}

function isCredentials(value: unknown): value is E2ECredentials {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const credentials = value as E2ECredentials;
  return (
    isUser(credentials.primary) &&
    isUser(credentials.secondary) &&
    isUser(credentials.emailChange) &&
    typeof credentials.emailChangeTarget === 'string' &&
    credentials.emailChangeTarget.length > 0
  );
}

function buildCredentials(existing: E2ECredentials | null): E2ECredentials {
  const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  return {
    primary: {
      email:
        process.env.E2E_USER_EMAIL || existing?.primary.email || randomEmail('e2e-primary', runId),
      name: process.env.E2E_USER_NAME || existing?.primary.name || `E2E Primary ${runId}`,
      password: process.env.E2E_USER_PASSWORD || existing?.primary.password || randomPassword(),
    },
    secondary: {
      email:
        process.env.E2E_USER_B_EMAIL ||
        existing?.secondary.email ||
        randomEmail('e2e-secondary', runId),
      name: process.env.E2E_USER_B_NAME || existing?.secondary.name || `E2E Secondary ${runId}`,
      password: process.env.E2E_USER_B_PASSWORD || existing?.secondary.password || randomPassword(),
    },
    emailChange: {
      email:
        process.env.E2E_EMAIL_CHANGE_USER_EMAIL ||
        existing?.emailChange.email ||
        randomEmail('e2e-email-change', runId),
      name:
        process.env.E2E_EMAIL_CHANGE_USER_NAME ||
        existing?.emailChange.name ||
        `E2E Email Change ${runId}`,
      password:
        process.env.E2E_EMAIL_CHANGE_USER_PASSWORD ||
        existing?.emailChange.password ||
        randomPassword(),
    },
    emailChangeTarget:
      process.env.E2E_EMAIL_CHANGE_TARGET ||
      existing?.emailChangeTarget ||
      randomEmail('e2e-email-change-target', runId),
  };
}

function readCredentials(): E2ECredentials | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    return isCredentials(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeCredentials(credentials: E2ECredentials): void {
  fs.mkdirSync(path.dirname(credentialsPath), { recursive: true });
  fs.writeFileSync(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Resolves the credentials for this E2E run. Called once from global setup, before workers
 * start; the generated values are reused by workers and teardown instead of regenerated.
 */
export function prepareE2ECredentials(): E2ECredentials {
  const existing = readCredentials();
  const credentials = buildCredentials(existing);
  if (!existing || JSON.stringify(existing) !== JSON.stringify(credentials)) {
    writeCredentials(credentials);
  }
  cached = credentials;
  return credentials;
}

export function getE2ECredentials(): E2ECredentials {
  if (cached) {
    return cached;
  }
  cached = readCredentials() ?? prepareE2ECredentials();
  return cached;
}
