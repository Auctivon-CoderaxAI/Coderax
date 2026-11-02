import { expect, test } from '@playwright/test';

test.describe('Chat and Work model controls', () => {
  test('Chat has no provider or model controls', async ({ page }) => {
    await page.goto('/c/new', { timeout: 10_000 });
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
    await expect(page.getByTestId('model-selector-button')).toHaveCount(0);
    await expect(page.getByTestId('work-model-selector')).toHaveCount(0);
  });

  test('Work shows the authenticated available model catalog beside the task composer', async ({
    page,
  }) => {
    await page.goto('/work', { timeout: 10_000 });
    const selector = page.getByRole('combobox', { name: 'Model' });
    await expect(selector).toBeVisible();
    await expect(selector.locator('option', { hasText: 'Automatic' })).toHaveCount(1);
    await expect(selector.locator('option', { hasText: 'e2e-work-local-a' })).toHaveCount(1);
    await expect(selector.locator('option', { hasText: 'e2e-work-local-b' })).toHaveCount(1);
    await expect(page.locator('#work-task')).toBeVisible();
  });
});
