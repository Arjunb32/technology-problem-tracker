import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';

test('core desktop and mobile screens have no automated WCAG A or AA violations', async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  const failures = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const path of [
      '/',
      '/problems/demo-wifi',
      '/report',
      '/moderation',
      '/settings',
      '/notifications',
      '/profiles/demo-alex',
    ]) {
      await page.goto(path);
      if (['/moderation', '/settings', '/notifications'].includes(path)) {
        await page.evaluate(() => localStorage.setItem('tracker.demoToken', 'demo:demo-morgan'));
        await page.reload();
      }
      await expect(page.locator('.loading-state')).toHaveCount(0);
      await expect(page.getByRole('main')).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      for (const violation of results.violations)
        failures.push({
          width,
          path,
          rule: violation.id,
          nodes: violation.nodes.map((node) => ({
            target: node.target,
            summary: node.failureSummary,
          })),
        });
    }
  }
  await testInfo.attach('accessibility-results', {
    body: JSON.stringify(failures, null, 2),
    contentType: 'application/json',
  });
  await mkdir('.data', { recursive: true });
  await writeFile('.data/accessibility-results.json', JSON.stringify(failures, null, 2));
  expect(
    failures.map((item) => ({
      width: item.width,
      path: item.path,
      rule: item.rule,
      affected: item.nodes.length,
    })),
  ).toEqual([]);
});

test('sign-in, contribution, test, and moderation dialogs have no automated accessibility violations', async ({
  page,
}) => {
  test.setTimeout(90000);
  async function checkScreen(name: string) {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map((item) => ({
        screen: name,
        rule: item.id,
        nodes: item.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })),
      })),
    ).toEqual([]);
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('tracker.demoToken'));
    await page.reload();
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await checkScreen(`sign-in ${width}`);
    await page.keyboard.press('Escape');
    await page.evaluate(() => localStorage.setItem('tracker.demoToken', 'demo:demo-morgan'));
    await page.goto('/problems/demo-wifi');
    await page.getByTestId('affected-button').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await checkScreen(`affected ${width}`);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'I tested this' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await checkScreen(`test result ${width}`);
    await page.keyboard.press('Escape');
    await page.goto('/moderation');
    await page.getByRole('button', { name: 'Review & verify' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await checkScreen(`verification ${width}`);
    await page.keyboard.press('Escape');
    await page.goto('/problems/demo-wifi/solutions/new');
    await expect(page.locator('.contribution-form')).toBeVisible();
    await checkScreen(`solution form ${width}`);
    await page.goto('/privacy');
    await expect(page.locator('.policy-page')).toBeVisible();
    await checkScreen(`privacy ${width}`);
  }
});
