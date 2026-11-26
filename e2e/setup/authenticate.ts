import { chromium, request } from '@playwright/test';
import type { FullConfig, Page } from '@playwright/test';
import type { User } from '../types';
import cleanupUser from './cleanupUser';
import dotenv from 'dotenv';
dotenv.config();

const timeout = Number(process.env.E2E_AUTH_TIMEOUT ?? 15000);
const chromiumChannel = process.env.E2E_CHROMIUM_CHANNEL || undefined;

export async function submitRegistration(page: Page, user: User) {
  await page.getByLabel('Full name').click();
  await page.getByLabel('Full name').fill(user.name);
  await page.getByLabel('Email').click();
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Email').press('Tab');
  await page.getByTestId('password').click();
  await page.getByTestId('password').fill(user.password);
  await page.getByTestId('confirm_password').click();
  await page.getByTestId('confirm_password').fill(user.password);
  await page.getByLabel('Submit registration').click();
}

export async function register(page: Page, user: User, baseURL: string) {
  // The default /login route now redirects to passwordless guest entry, which
  // intentionally has no account-creation link. Specs that need the form still
  // provision their named password user through the explicit registration route.
  await page.goto(appURL(baseURL, 'register'));
  await submitRegistration(page, user);
}

async function registrationErrorIsVisible(page: Page) {
  return page
    .getByTestId('registration-error')
    .isVisible({ timeout: 500 })
    .catch(() => false);
}

export async function login(page: Page, user: User) {
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByTestId('login-button').click();
}

export function appURL(baseURL: string, pathname = '') {
  const normalizedBaseURL = baseURL.endsWith('/') ? baseURL : `${baseURL}/`;
  return new URL(pathname.replace(/^\/+/, ''), normalizedBaseURL).toString();
}

/**
 * Provisions the owner account through the auth endpoint, not the public form.
 *
 * The application is owner-only: the registration page is not a supported way
 * for a stranger to obtain an account, and its markup is free to change without
 * being an authentication contract. Driving the endpoint keeps the harness off
 * that surface while leaving the deployment's own registration gate in charge —
 * when it answers 403 the owner has to be provisioned by the deployment, and
 * this fails with that instruction instead of opening public registration.
 */
async function provisionOwner(baseURL: string, user: User) {
  const origin = new URL(baseURL).origin;
  const context = await request.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const response = await context.post('/api/auth/register', {
      headers: { Origin: origin },
      data: {
        name: user.name,
        email: user.email,
        username: '',
        password: user.password,
        confirm_password: user.password,
      },
    });
    return { status: response.status(), ok: response.ok(), body: await response.text() };
  } finally {
    await context.dispose();
  }
}

async function authenticate(config: FullConfig, user: User) {
  console.log('🤖: global setup has been started');
  const { baseURL, storageState } = config.projects[0].use;
  console.log('🤖: using baseURL', baseURL);
  console.log('🤖: using E2E user:', user.email);
  if (typeof storageState !== 'string') {
    throw new Error('🤖: storageState must be a file path');
  }
  if (typeof baseURL !== 'string') {
    throw new Error('🤖: baseURL is not defined');
  }

  const browser = await chromium.launch({
    headless: config.projects[0].use.headless ?? true,
    ...(chromiumChannel ? { channel: chromiumChannel } : {}),
  });
  try {
    const page = await browser.newPage();
    const conversationURL = appURL(baseURL, 'c/new');
    const loginURL = appURL(baseURL, 'login?manual=1');

    await page.context().addInitScript(() => {
      localStorage.setItem('navVisible', 'true');
    });

    const signIn = async () => {
      await page.goto(loginURL, { timeout });
      await login(page, user);
      try {
        await page.waitForURL(conversationURL, { timeout: 10_000 });
        return true;
      } catch {
        return false;
      }
    };

    console.log('🤖: 🗝  authenticating user:', user.email);
    let signedIn = await signIn();
    if (!signedIn) {
      /* A previous run may have left the account behind with another password. */
      await cleanupUser(user).catch(() => undefined);
      const provisioned = await provisionOwner(baseURL, user);
      if (!provisioned.ok) {
        throw new Error(
          `🤖: 🚨  owner account is not provisioned and this deployment refused to create it ` +
            `(${provisioned.status}). Provision the owner once in this environment, or run ` +
            `the mock profile, which allows registration for its disposable test owner. ` +
            `Public registration must not be enabled to make the suite pass.`,
        );
      }
      console.log('🤖: ✔️  owner account provisioned through the auth API');
      signedIn = await signIn();
      if (!signedIn) {
        if (await registrationErrorIsVisible(page)) {
          throw new Error('🤖: 🚨  owner account provisioning was rejected');
        }
        throw new Error('🤖: 🚨  owner account failed to authenticate after provisioning');
      }
    }
    console.log('🤖: ✔️  user successfully authenticated');

    await page.context().storageState({ path: storageState });
    console.log('🤖: ✔️  authentication state successfully saved in', storageState);
  } finally {
    await browser.close();
    console.log('🤖: global setup has been finished');
  }
}

export default authenticate;
