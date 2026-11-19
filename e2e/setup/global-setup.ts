import { FullConfig } from '@playwright/test';
import authenticate from './authenticate';
import { prepareE2ECredentials } from './credentials';
import { getE2EUser } from './user';

async function globalSetup(config: FullConfig) {
  prepareE2ECredentials();
  await authenticate(config, getE2EUser());
}

export default globalSetup;
