import { expect, test } from '@playwright/test';
import { mockReply, NEW_CHAT_PATH } from './helpers';

const LOCAL_MODEL_A = 'e2e-work-local-a';
const LOCAL_MODEL_B = 'e2e-work-local-b';

test.describe('automatic Chat routing and native Work model selection', () => {
  test('Chat hides model controls and fails over between configured local models', async ({
    page,
  }) => {
    const attempts: Array<{ endpoint?: string; model?: string }> = [];
    await page.route('**/api/agents/chat/**', async (route) => {
      const request = route.request();
      if (request.method() !== 'POST') {
        await route.continue();
        return;
      }

      const payload = request.postDataJSON() as { endpoint?: string; model?: string };
      attempts.push(payload);
      if (payload.model === LOCAL_MODEL_A) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'LOCAL_MODEL_UNAVAILABLE' }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto(NEW_CHAT_PATH);
    const input = page.getByRole('textbox', { name: 'Message input' });
    await expect(input).toBeVisible();
    await expect(page.getByTestId('model-selector-button')).toHaveCount(0);
    await expect(page.getByTestId('work-model-selector')).toHaveCount(0);

    await input.fill('Use the configured local model automatically.');
    const [start] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname.startsWith('/api/agents/chat') &&
          response.status() === 200,
        { timeout: 30_000 },
      ),
      input.press('Enter'),
    ]);
    expect(start.status()).toBe(200);

    await expect(mockReply(page)).toBeVisible({ timeout: 20_000 });
    expect(attempts.map(({ model }) => model)).toEqual([LOCAL_MODEL_A, LOCAL_MODEL_B]);
    expect(attempts.every(({ endpoint }) => endpoint?.toLowerCase() === 'ollama')).toBe(true);
  });

  test('Work selection reaches the native runner and completes with CyVox disabled', async ({
    page,
  }) => {
    const workStarts: Array<{ endpoint?: string; model?: string }> = [];
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST' && pathname.startsWith('/api/work/chat')) {
        workStarts.push(request.postDataJSON() as { endpoint?: string; model?: string });
      }
    });

    await page.goto('/work');
    const selector = page.getByRole('combobox', { name: 'Model' });
    await expect(selector).toBeVisible();
    await expect(page.getByTestId('model-selector-button')).toHaveCount(0);
    await expect(selector.locator('option').filter({ hasText: LOCAL_MODEL_B })).toHaveCount(1);
    await selector.selectOption({ label: LOCAL_MODEL_B });
    await expect(page.getByTestId('work-selection-summary')).toHaveText(
      `Runs on ${LOCAL_MODEL_B}.`,
    );

    const taskInput = page.locator('#work-task');
    await taskInput.fill('Reply with the mock result.');
    await expect(taskInput).toHaveValue('Reply with the mock result.');
    const startButton = page.locator('form button[type="submit"]');
    await expect(startButton).toBeEnabled();
    const [response] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.request().method() === 'POST' &&
          new URL(candidate.url()).pathname.startsWith('/api/work/chat'),
        { timeout: 30_000 },
      ),
      startButton.click(),
    ]);
    expect(response.status()).toBe(200);

    await expect(mockReply(page)).toBeVisible({ timeout: 20_000 });
    expect(workStarts).toHaveLength(1);
    expect(workStarts[0]?.model).toBe(LOCAL_MODEL_B);
    await expect(page).toHaveURL(/\/work\/(?!new)[^/?]+/);

    const conversationId = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1)!);
    const conversation = await page.evaluate(async (id) => {
      const refresh = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const { token } = (await refresh.json()) as { token: string };
      const response = await fetch(`/api/convos/${encodeURIComponent(id)}`, {
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.ok ? response.json() : { status: response.status };
    }, conversationId);
    expect(conversation).toMatchObject({
      isWork: true,
      workModel: LOCAL_MODEL_B,
      endpoint: 'ollama',
    });
  });
});
