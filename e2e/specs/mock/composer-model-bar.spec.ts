import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  MOCK_ENDPOINTS,
  NEW_CHAT_PATH,
  mockReply,
  selectMockEndpoint,
  sendMessage,
} from './helpers';

const MODEL_BAR = 'composer-model-bar';
const MODEL_TRIGGER = 'Select a model';

const modelTrigger = (page: Page) => page.getByRole('button', { name: MODEL_TRIGGER }).first();

/** Screenshots are a local inspection aid; CI does not need repo-root artifacts. */
async function capture(page: Page, name: string) {
  if (process.env.E2E_SCREENSHOTS === '1') {
    await page.screenshot({ path: `screenshots/${name}.png` });
  }
}

/**
 * The read-out describes persisted conversation state. It must name the model
 * the next message will use, follow a switch, survive a reload of the saved
 * conversation, and never become a second control.
 */
test.describe('composer active-model read-out', () => {
  test.use({ colorScheme: 'light' });

  test('follows the picker, survives a saved conversation, and stays a read-out', async ({
    page,
  }) => {
    await page.goto(NEW_CHAT_PATH);
    await expect(modelTrigger(page)).toBeVisible();

    const bar = page.getByTestId(MODEL_BAR);
    const triggerText = (await modelTrigger(page).textContent())?.trim() ?? '';
    if (triggerText === MODEL_TRIGGER || triggerText === '') {
      /* Nothing is attached yet, so there is nothing truthful to describe. */
      await expect(bar).toHaveCount(0);
    } else {
      /* A model spec presets the conversation, so the picker names the spec while
         the read-out names the model that spec resolves to. */
      await expect(bar).toBeVisible();
      await expect(bar).not.toBeEmpty();
    }

    const [first, second] = MOCK_ENDPOINTS;
    await selectMockEndpoint(page, first);
    await expect(bar).toContainText(first.model);
    await expect(bar).toContainText(first.label);
    await expect(modelTrigger(page)).not.toHaveText(MODEL_TRIGGER);
    await capture(page, 'composer-model-bar-light');

    await selectMockEndpoint(page, second);
    await expect(bar).toContainText(second.model);
    await expect(bar).not.toContainText(first.model);
    await expect(bar).toContainText(second.label);
    await expect(modelTrigger(page)).toContainText(second.label);

    /* One control, one read-out: the strip owns no interactive element, and the
       picker stays the only model selector in the composer. */
    await expect(bar.locator('button, a, input, select, textarea')).toHaveCount(0);
    await expect(page.getByRole('button', { name: MODEL_TRIGGER })).toHaveCount(1);

    await sendMessage(page, 'Model read-out persistence check');
    await expect(mockReply(page)).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/c\/(?!new)/, { timeout: 15_000 });

    await page.reload();
    await expect(page.getByTestId(MODEL_BAR)).toContainText(second.model, { timeout: 15_000 });
    await expect(page.getByTestId(MODEL_BAR)).toContainText(second.label);
  });
});

test.describe('composer active-model read-out on the dark canvas and a phone', () => {
  test.use({ colorScheme: 'dark' });

  test('keeps the read-out legible at both sizes', async ({ page }) => {
    await page.goto(NEW_CHAT_PATH);
    await expect(modelTrigger(page)).toBeVisible();
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);

    const bar = page.getByTestId(MODEL_BAR);
    await expect(bar).toContainText(MOCK_ENDPOINTS[0].model);
    await capture(page, 'composer-model-bar-dark');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(bar).toBeVisible();
    await expect(bar).toContainText(MOCK_ENDPOINTS[0].model);
    await capture(page, 'composer-model-bar-mobile');
  });
});
