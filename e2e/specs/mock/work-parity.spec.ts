import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  getAccessToken,
  mockReply,
  NEW_CHAT_PATH,
  requestJson,
  sendMessageAndWaitForCompletion,
  uploadViaUnifiedButton,
} from './helpers';

const LOCAL_MODEL_B = 'e2e-work-local-b';
const modeNav = (page: Page) => page.getByRole('navigation', { name: 'Conversation mode' });
const composer = (page: Page) => page.getByTestId('composer-surface');
const input = (page: Page) => page.getByRole('textbox', { name: 'Message input' });
const workSelection = (page: Page) => page.getByTestId('work-agent-selection');

async function selectWorkOption(page: Page, control: 'Model' | 'Work agent', option: RegExp) {
  await workSelection(page).getByRole('button', { name: control, exact: true }).click();
  await page.getByRole('menuitemradio', { name: option }).click();
}

async function switchMode(page: Page, mode: 'Chat' | 'Work') {
  const url = page.url();
  const historyLength = await page.evaluate(() => history.length);
  const element = await composer(page).elementHandle();
  const before = await composer(page).boundingBox();
  await modeNav(page).getByRole('button', { name: mode, exact: true }).click();
  await expect(modeNav(page).getByRole('button', { name: mode, exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  if (mode === 'Work') {
    await expect(
      workSelection(page).getByRole('button', { name: 'Model', exact: true }),
    ).toBeVisible();
  }
  await expect(page).toHaveURL(url);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  expect(await composer(page).evaluate((node, original) => node === original, element)).toBe(true);
  /** Work adds its model controls inside the same composer, so only the
   * horizontal geometry must stay fixed; the height may grow on narrow screens. */
  await expect
    .poll(async () => {
      const after = await composer(page).boundingBox();
      return after && { x: after.x, width: after.width };
    })
    .toEqual(before && { x: before.x, width: before.width });
  await expect(page.locator('main')).toHaveCount(1);
  await expect(modeNav(page)).toHaveCount(1);
}

async function workStart(page: Page, text: string) {
  await input(page).fill(text);
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.request().method() === 'POST' &&
        new URL(candidate.url()).pathname.startsWith('/api/work/chat'),
    ),
    input(page).press('Enter'),
  ]);
  expect(response.status()).toBe(200);
  return response;
}

test.describe('continuous Chat and Work conversation', () => {
  test('idle Chat does not poll Work history at the active cadence', async ({ page }) => {
    let taskRequests = 0;
    await page.route('**/api/work/tasks', (route) => route.fulfill({ json: { tasks: [] } }));
    await page.route('**/api/agents/chat/active', (route) =>
      route.fulfill({ json: { activeJobIds: [] } }),
    );
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/work/tasks') {
        taskRequests += 1;
      }
    });
    const initialTasks = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/work/tasks',
    );
    await page.goto(NEW_CHAT_PATH);
    await initialTasks;
    await expect(input(page)).toBeVisible();
    const baseline = taskRequests;
    await page.waitForTimeout(12_000);
    expect(taskRequests - baseline).toBe(0);
  });

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    test(`${viewport.name}: modes retain URL, draft and shared layout`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(NEW_CHAT_PATH);
      await input(page).fill('Keep this unsent draft.');
      await test.info().attach(`${viewport.name}-chat`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      await switchMode(page, 'Work');
      await expect(input(page)).toHaveValue('Keep this unsent draft.');
      await test.info().attach(`${viewport.name}-work`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      await switchMode(page, 'Chat');
      await expect(input(page)).toHaveValue('Keep this unsent draft.');
    });
  }

  test('an existing Chat transcript becomes Work in place and survives reload in either mode', async ({
    page,
  }) => {
    await page.goto(NEW_CHAT_PATH);
    await sendMessageAndWaitForCompletion(page, 'Keep this conversation history.');
    const url = page.url();
    const id = new URL(url).pathname.split('/').at(-1)!;
    await switchMode(page, 'Work');
    await selectWorkOption(page, 'Model', new RegExp(LOCAL_MODEL_B));
    const replies = await mockReply(page).count();
    const start = await workStart(page, 'Reply with the mock result.');
    expect(start.request().postDataJSON().conversationId).toBe(id);
    expect(start.request().postDataJSON().model).toBe(LOCAL_MODEL_B);
    await expect(mockReply(page)).toHaveCount(replies + 1);
    await expect(page).toHaveURL(url);
    await page.reload();
    await expect(modeNav(page).getByRole('button', { name: 'Work' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText('Keep this conversation history.', { exact: true })).toBeVisible();
    await switchMode(page, 'Chat');
    await page.reload();
    await expect(modeNav(page).getByRole('button', { name: 'Chat', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page).toHaveURL(url);
    await expect(page.getByText('Keep this conversation history.', { exact: true })).toBeVisible();
  });

  test('a project stays with the conversation across both mode changes and reload', async ({
    page,
  }) => {
    await page.goto(NEW_CHAT_PATH);
    const token = await getAccessToken(page);
    const project = await requestJson<{ _id: string }>(page, {
      path: '/api/projects',
      method: 'POST',
      token,
      body: { name: `Continuous project ${Date.now()}` },
    });
    try {
      await page.goto(`/c/new?projectId=${project._id}`);
      await sendMessageAndWaitForCompletion(page, 'Keep this project context.');
      const url = page.url();
      const id = new URL(url).pathname.split('/').at(-1)!;

      await switchMode(page, 'Work');
      await switchMode(page, 'Chat');

      const stored = await requestJson<{ chatProjectId?: string }>(page, {
        path: `/api/convos/${encodeURIComponent(id)}`,
        token,
      });
      expect(stored.chatProjectId).toBe(project._id);
      await page.reload();
      await expect(page.getByText('Keep this project context.', { exact: true })).toBeVisible();
      await expect(page).toHaveURL(url);
    } finally {
      await requestJson(page, {
        path: `/api/projects/${encodeURIComponent(project._id)}`,
        method: 'DELETE',
        token,
      });
    }
  });

  test('switching modes does not abort or restart an active Work generation', async ({ page }) => {
    const controls: string[] = [];
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() === 'POST' && /\/(chat|abort)/.test(path)) {
        controls.push(path);
      }
    });
    await page.goto('/work/new');
    await workStart(page, 'E2E_SLOW_REPLY:continuous-work');
    await expect(page).not.toHaveURL(/\/work\/new$/);
    await expect(page.getByTestId('messages-view')).toBeVisible();
    await switchMode(page, 'Chat');
    await switchMode(page, 'Work');
    expect(controls.filter((path) => path.startsWith('/api/work/chat'))).toHaveLength(1);
    expect(controls.some((path) => path.endsWith('/abort'))).toBe(false);
    await expect(page.getByText(/E2E slow reply continuous-work.*chunk-159/).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test('unsent attachments stay attached across both mode changes', async ({ page }) => {
    await page.goto(NEW_CHAT_PATH);
    await sendMessageAndWaitForCompletion(page, 'Keep my staged attachment.');
    await input(page).fill('Draft with attachment');
    const upload = await uploadViaUnifiedButton(page, {
      name: 'continuous-requirements.md',
      mimeType: 'text/markdown',
      content: '# Requirements\nKeep this file attached.\n',
    });
    expect(upload.ok()).toBe(true);
    const tray = page.getByTestId('composer-tray');
    await expect(tray).toContainText('continuous-requirements.md');
    await switchMode(page, 'Work');
    await expect(tray).toContainText('continuous-requirements.md');
    await switchMode(page, 'Chat');
    await expect(tray).toContainText('continuous-requirements.md');
    await expect(input(page)).toHaveValue('Draft with attachment');
  });

  test('a legacy Work deep link keeps its pathname when switching to Chat', async ({ page }) => {
    await page.goto('/work/new');
    await expect(input(page)).toBeVisible();
    await switchMode(page, 'Chat');
    await switchMode(page, 'Work');
    await expect(page).toHaveURL(/\/work\/new$/);
  });

  test('the server refuses a paid model and an unsupported second conversation', async ({
    page,
  }) => {
    await page.goto(NEW_CHAT_PATH);
    const token = await getAccessToken(page);
    const results = await page.evaluate(async (bearer) => {
      const post = async (body: Record<string, unknown>) => {
        const response = await fetch('/api/work/chat/openAI', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
          body: JSON.stringify({ text: 'hi', conversationId: 'new', ...body }),
        });
        const json = await response.json();
        return { status: response.status, error: json.error ?? json.code };
      };
      return {
        paid: await post({ endpoint: 'openAI', model: 'gpt-4o' }),
        second: await post({ model: 'auto', addedConvo: { model: 'gpt-4o' } }),
      };
    }, token);
    expect(results.paid).toEqual({ status: 409, error: 'WORK_MODEL_NOT_ALLOWED' });
    expect(results.second).toEqual({
      status: 400,
      error: 'WORK_ADDED_CONVERSATION_UNSUPPORTED',
    });
  });

  test('the selected eligible agent reaches the native runner on its actual model', async ({
    page,
  }) => {
    await page.goto(NEW_CHAT_PATH);
    const token = await getAccessToken(page);
    const agent = await requestJson<{ id: string; name?: string }>(page, {
      path: '/api/agents',
      method: 'POST',
      token,
      body: {
        name: `Free Work reviewer ${Date.now()}`,
        provider: 'ollama',
        model: LOCAL_MODEL_B,
        tools: [],
        model_parameters: {},
      },
    });
    try {
      await switchMode(page, 'Work');
      await selectWorkOption(page, 'Work agent', new RegExp(agent.name ?? agent.id));
      const start = await workStart(page, 'Reply with the mock result.');
      expect(start.request().postDataJSON()).toMatchObject({
        agent_id: agent.id,
        model: LOCAL_MODEL_B,
      });
      await expect(mockReply(page)).toBeVisible();
    } finally {
      await requestJson(page, {
        path: `/api/agents/${encodeURIComponent(agent.id)}`,
        method: 'DELETE',
        token,
      });
    }
  });
});
