import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const folder = resolve('.data/visual-review');
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
const errors = [];
const measurements = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (error) => errors.push(error.message));
  for (const screen of [
    { name: 'feed-desktop', path: '/', width: 1440, height: 1000 },
    { name: 'feed-mobile', path: '/', width: 390, height: 844 },
    { name: 'problem-desktop', path: '/problems/demo-wifi', width: 1440, height: 1000 },
    { name: 'problem-mobile', path: '/problems/demo-wifi', width: 390, height: 844 },
    { name: 'report-desktop', path: '/report', width: 1440, height: 1000 },
    { name: 'report-mobile', path: '/report', width: 390, height: 844 },
    { name: 'moderation-desktop', path: '/moderation', width: 1440, height: 1000, moderator: true },
    { name: 'moderation-mobile', path: '/moderation', width: 390, height: 844, moderator: true },
  ]) {
    await page.setViewportSize({ width: screen.width, height: screen.height });
    await page.goto(`http://127.0.0.1:5173${screen.path}`);
    if (screen.moderator) {
      await page.evaluate(() => localStorage.setItem('tracker.demoToken', 'demo:demo-morgan'));
      await page.reload();
      await page.getByRole('heading', { name: 'Moderation workspace' }).waitFor();
    } else if (screen.path.includes('/problems/')) {
      await page.locator('.detail-card h1').waitFor();
    } else if (screen.path === '/') {
      await page.locator('.problem-card').first().waitFor();
    } else {
      await page.locator('.contribution-form').waitFor();
    }
    await page.screenshot({ path: resolve(folder, `${screen.name}.png`), fullPage: false });
    measurements.push({
      screen: screen.name,
      ...(await page.evaluate(() => ({
        viewport: innerWidth,
        content: document.documentElement.scrollWidth,
        overflows: [...document.querySelectorAll('body *')]
          .filter((el) => {
            const bounds = el.getBoundingClientRect();
            return (
              getComputedStyle(el).display !== 'none' &&
              bounds.width > 0 &&
              bounds.right > innerWidth + 1
            );
          })
          .slice(0, 12)
          .map((el) => `${el.tagName}.${el.className}`),
      }))),
    });
  }
  await writeFile(
    resolve(folder, 'results.json'),
    JSON.stringify({ measurements, errors }, null, 2),
  );
  console.log(JSON.stringify({ folder, measurements, errors }, null, 2));
  if (errors.length || measurements.some((item) => item.content > item.viewport))
    process.exitCode = 1;
} finally {
  await browser.close();
}
