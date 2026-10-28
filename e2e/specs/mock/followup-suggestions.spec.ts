import { expect, test } from '@playwright/test';
import {
  MOCK_ENDPOINTS,
  NEW_CHAT_PATH,
  messagesView,
  selectMockEndpoint,
  sendMessage,
} from './helpers';

const ANSWER = 'E2E followup answer complete';
const FIRST_LABEL = 'Add retry tests';
const SECOND_LABEL = 'Split the provider';
const FIRST_PROMPT = 'Add retry with backoff to the deploy poller tests.';
const SECOND_PROMPT = 'Split the provider into transport and retry modules.';

test.describe('follow-up suggestions', () => {
  test('offers chips under the reply and fills the composer when one is clicked', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const label = `followups-${Date.now()}`;

    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);
    expect((await sendMessage(page, `E2E_FOLLOWUPS_REPLY:${label}`)).ok()).toBeTruthy();

    const view = messagesView(page);
    const chips = view.getByTestId('followup-suggestions');
    await expect(chips).toBeVisible({ timeout: 30_000 });
    await expect(chips).toContainText('Suggested follow-ups');

    const first = chips.getByRole('button', { name: FIRST_LABEL });
    const second = chips.getByRole('button', { name: SECOND_LABEL });
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
    await expect(first).toHaveAttribute('title', FIRST_PROMPT);
    await expect(second).toHaveAttribute('title', SECOND_PROMPT);

    /** The card exists to sit under the finished reply, so assert the position
     *  rather than only the presence. */
    const answer = view.getByText(`${ANSWER} ${label}`);
    await expect(answer).toBeVisible();
    const answerBox = await answer.boundingBox();
    const chipsBox = await chips.boundingBox();
    expect(answerBox).not.toBeNull();
    expect(chipsBox).not.toBeNull();
    expect(chipsBox?.y ?? 0).toBeGreaterThan(answerBox?.y ?? 0);

    /** A click stages the whole prompt in the composer instead of sending it. */
    const composer = page.getByRole('textbox', { name: 'Message input' });
    await expect(composer).toHaveValue('');
    await first.click();
    await expect(composer).toHaveValue(FIRST_PROMPT);
    await expect(composer).toBeFocused();

    /** Proof artifact for the failure report and for a local run's eyeballing. */
    await page.screenshot({ path: testInfo.outputPath('followup-chips.png') });
  });
});
