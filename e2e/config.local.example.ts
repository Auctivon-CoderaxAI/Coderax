// copy as `config.local.ts` and set E2E_USER_EMAIL / E2E_USER_PASSWORD for your local account
import type { User } from './types';

const localUser: User = {
  email: process.env.E2E_USER_EMAIL ?? 'your-local-test-user@example.com',
  name: process.env.E2E_USER_NAME ?? 'Your Local Test User',
  password: process.env.E2E_USER_PASSWORD ?? '',
};

export default localUser;
