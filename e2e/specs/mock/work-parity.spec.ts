import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mockReply, NEW_CHAT_PATH } from './helpers';

const LOCAL_MODEL_B = 'e2e-work-local-b';

type Geometry = {
  mains: number;
  navCenter: number;
  canvasCenter: number;
  surfaceX: number;
  surfaceWidth: number;
  surfaceBottom: number;
  radius: string;
  greetingSize: string;
  viewportHeight: number;
};

/** Measures the parts Chat and Work must share on their welcome screens. */
async function landingGeometry(page: Page, path: string): Promise<Geometry> {
  await page.goto(path);
  const surface = page.locator(
    '[data-testid="composer-surface"], [data-testid="work-composer-surface"]',
  );
  await expect(surface).toBeVisible();
  /* Landing clearance and width animate; measure the settled layout. */
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const main = document.querySelector('main') as HTMLElement;
    const nav = document.querySelector('nav[aria-label="Conversation mode"]') as HTMLElement;
    const box = document.querySelector(
      '[data-testid="composer-surface"], [data-testid="work-composer-surface"]',
    ) as HTMLElement;
    const greeting = [...main.querySelectorAll('h1, h2')].find(
      (heading) =>
        !heading.classList.contains('sr-only') && heading.getBoundingClientRect().width > 1,
    ) as HTMLElement;
    const mainRect = main.getBoundingClientRect();
    const navRect = nav.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    return {
      mains: document.querySelectorAll('main').length,
      navCenter: navRect.x + navRect.width / 2,
      canvasCenter: mainRect.x + mainRect.width / 2,
      surfaceX: boxRect.x,
      surfaceWidth: boxRect.width,
      surfaceBottom: boxRect.bottom,
      radius: getComputedStyle(box).borderRadius,
      greetingSize: getComputedStyle(greeting).fontSize,
      viewportHeight: window.innerHeight,
    };
  });
}

async function expectSharedLanding(page: Page, label: string) {
  const chat = await landingGeometry(page, NEW_CHAT_PATH);
  await test.info().attach(`${label}-chat`, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  const work = await landingGeometry(page, '/work');
  await test.info().attach(`${label}-work`, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });

  expect(chat.mains).toBe(1);
  expect(work.mains).toBe(1);
  expect(Math.abs(chat.navCenter - chat.canvasCenter)).toBeLessThanOrEqual(1);
  expect(Math.abs(work.navCenter - work.canvasCenter)).toBeLessThanOrEqual(1);
  expect(Math.abs(work.surfaceX - chat.surfaceX)).toBeLessThanOrEqual(1);
  expect(Math.abs(work.surfaceWidth - chat.surfaceWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(work.surfaceBottom - chat.surfaceBottom)).toBeLessThanOrEqual(1);
  expect(work.radius).toBe(chat.radius);
  expect(work.greetingSize).toBe(chat.greetingSize);
  return { chat, work };
}

async function workStart(page: Page, description: string) {
  const starts: Array<Record<string, unknown>> = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname.startsWith('/api/work/chat')
    ) {
      starts.push(request.postDataJSON() as Record<string, unknown>);
    }
  });
  const taskInput = page.locator('#work-task');
  await taskInput.fill(description);
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.request().method() === 'POST' &&
        new URL(candidate.url()).pathname.startsWith('/api/work/chat'),
      { timeout: 30_000 },
    ),
    page.getByRole('button', { name: 'Start task' }).click(),
  ]);
  return { response, starts };
}

/** API reads authenticate as the app does: a bearer token from the refresh cookie. */
async function accessToken(page: Page): Promise<string> {
  const token = await page.evaluate(async () => {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = (await response.json().catch(() => null)) as { token?: string } | null;
    return body?.token ?? null;
  });
  expect(token, 'refresh should issue an access token').toBeTruthy();
  return token as string;
}

async function readConversation(page: Page) {
  await expect(page).toHaveURL(/\/work\/(?!new)[^/?]+/);
  const conversationId = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1)!);
  const token = await accessToken(page);
  return page.evaluate(
    async ({ id, bearer }) => {
      const response = await fetch(`/api/convos/${encodeURIComponent(id)}`, {
        credentials: 'include',
        headers: { Authorization: `Bearer ${bearer}` },
      });
      return response.ok ? response.json() : { status: response.status };
    },
    { id: conversationId, bearer: token },
  );
}

test.describe('Chat and Work share one layout', () => {
  test('desktop: switch, greeting and composer sit in the same place in both modes', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await expectSharedLanding(page, 'desktop');
  });

  test('mobile: both composers run to the viewport floor', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { chat, work } = await expectSharedLanding(page, 'mobile');
    expect(Math.abs(chat.surfaceBottom - chat.viewportHeight)).toBeLessThanOrEqual(1);
    expect(Math.abs(work.surfaceBottom - work.viewportHeight)).toBeLessThanOrEqual(1);
    expect(work.radius).toMatch(/ 0px 0px$/);
  });
});

test.describe('Work agent and model selection', () => {
  test('defaults to automatic routing and runs on the model it names', async ({ page }) => {
    await page.goto('/work');
    const model = page.getByRole('combobox', { name: 'Model' });
    await expect(model).toHaveValue('auto');
    await expect(page.getByRole('combobox', { name: 'Work agent' })).toHaveValue('auto');
    const summary = page.getByTestId('work-selection-summary');
    await expect(summary).toHaveText(/^Runs on .+\.$/);
    const target = (await summary.textContent())!.replace(/^Runs on /, '').replace(/\.$/, '');

    const { response, starts } = await workStart(page, 'Reply with the mock result.');
    expect(response.status()).toBe(200);
    await expect(mockReply(page)).toBeVisible({ timeout: 20_000 });
    expect(starts).toHaveLength(1);
    expect(starts[0]?.agent_id ?? null).toBeNull();
    expect(starts[0]?.model).toBe(target);

    const conversation = await readConversation(page);
    expect(conversation).toMatchObject({ isWork: true, workModel: target });

    const modeNav = page.getByRole('navigation', { name: 'Conversation mode' });
    await expect(modeNav).toHaveCount(1);
    await expect(modeNav.getByRole('link', { name: 'Work' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.locator('main')).toHaveCount(1);
  });

  test('an explicit model survives a refresh and reaches the native runner', async ({ page }) => {
    await page.goto('/work');
    const model = page.getByRole('combobox', { name: 'Model' });
    await model.selectOption({ label: LOCAL_MODEL_B });
    await expect(page.getByTestId('work-selection-summary')).toHaveText(
      `Runs on ${LOCAL_MODEL_B}.`,
    );

    await page.reload();
    await expect(page.getByTestId('work-selection-summary')).toHaveText(
      `Runs on ${LOCAL_MODEL_B}.`,
    );

    const { response, starts } = await workStart(page, 'Reply with the mock result.');
    expect(response.status()).toBe(200);
    await expect(mockReply(page)).toBeVisible({ timeout: 20_000 });
    expect(starts[0]?.model).toBe(LOCAL_MODEL_B);
    expect(await readConversation(page)).toMatchObject({
      isWork: true,
      workModel: LOCAL_MODEL_B,
    });
  });

  test('the server refuses choices Work does not offer', async ({ page }) => {
    await page.goto('/work');
    await expect(page.getByTestId('work-selection-summary')).toBeVisible();
    const token = await accessToken(page);
    const results = await page.evaluate(async (bearer) => {
      const post = async (body: Record<string, unknown>) => {
        const response = await fetch('/api/work/chat/openAI', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
          body: JSON.stringify({ text: 'hi', conversationId: 'new', ...body }),
        });
        const json = await response.json().catch(() => ({}));
        return { status: response.status, error: json.error ?? json.code ?? null };
      };
      return {
        paidModel: await post({ endpoint: 'openAI', model: 'gpt-4o' }),
        addedConversation: await post({
          endpoint: 'openAI',
          model: 'auto',
          addedConvo: { endpoint: 'openAI', model: 'gpt-4o' },
        }),
        malformedAgent: await post({ endpoint: 'agents', agent_id: 'not valid!' }),
      };
    }, token);
    expect(results.paidModel).toEqual({ status: 409, error: 'WORK_MODEL_NOT_ALLOWED' });
    expect(results.addedConversation).toEqual({
      status: 400,
      error: 'WORK_ADDED_CONVERSATION_UNSUPPORTED',
    });
    expect(results.malformedAgent).toEqual({ status: 400, error: 'WORK_AGENT_ID_INVALID' });
  });
});
