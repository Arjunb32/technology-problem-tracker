import { expect, test } from '@playwright/test';

test('invalid feed filters and oversized page numbers produce a valid request', async ({
  page,
}) => {
  const result = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/v1/problems',
  );
  await page.goto('/?sort=unexpected&category=Unknown&page=900');
  const response = await result;
  expect(response.status()).toBe(200);
  const params = new URL(response.url()).searchParams;
  expect(params.get('sort')).toBe('trending');
  expect(params.get('offset')).toBe('500');
  expect(params.has('category')).toBe(false);
  await expect(page.getByText('No problems in this view yet')).toBeVisible();
});

test('unsent comments stay with their original problem during in-app navigation', async ({
  page,
}) => {
  await page.goto('/problems/demo-wifi');
  await page.getByRole('tab', { name: /Discussion/ }).click();
  await page.getByLabel('Your comment').fill('An unsent observation for this Wi-Fi report');
  await page
    .getByRole('link', { name: /DNS lookups fail/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: /DNS lookups fail/ }).first()).toBeVisible();
  await page.getByRole('tab', { name: /Discussion/ }).click();
  await expect(page.getByLabel('Your comment')).toHaveValue('');
  await page.goBack();
  await page.getByRole('tab', { name: /Discussion/ }).click();
  await expect(page.getByLabel('Your comment')).toHaveValue(
    'An unsent observation for this Wi-Fi report',
  );
});

test('clearing the title cancels the duplicate suggestion loading state', async ({ page }) => {
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/problems?*', async (route) => {
    await pending;
    await route.fulfill({ json: { items: [], total: 0 } });
  });
  try {
    await page.goto('/report');
    const title = page.getByTestId('problem-title-input');
    await title.fill('Network drops after resuming');
    await expect(page.getByText('Looking for similar reports…')).toBeVisible();
    await title.fill('');
    await expect(page.locator('.similar-problems')).toHaveCount(0);
  } finally {
    release();
  }
});
