export async function selectMockEndpoint(page: Page, endpoint: MockEndpoint) {
  const trigger = modelSelectorTrigger(page);
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();

  const endpointOption = page.getByRole('option', { name: endpoint.label });
  await expect(endpointOption).toBeVisible({ timeout: 30_000 });
  await endpointOption.click();

  const modelOption = page.getByRole('option', { name: endpoint.model, exact: true });
  await expect(modelOption).toBeVisible({ timeout: 30_000 });
  if (await modelOption.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await modelOption.click();
  }
  await expect(trigger).not.toHaveText('Select a model');
}
