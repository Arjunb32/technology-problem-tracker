import { test, expect, type Page } from '@playwright/test';

async function demoSignIn(page: Page, userId: string) {
  await page.goto('/');
  await page.getByTestId('login-button').last().click();
  await page.getByTestId(`demo-account-${userId}`).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('screenshots compress, persist, and remain reviewable only by moderators when hidden', async ({
  page,
  request,
}) => {
  const config = await (await request.get('/api/v1/config')).json();
  const member = config.demoAccounts.find((p: { role: string }) => p.role === 'member');
  const moderator = config.demoAccounts.find((p: { role: string }) => p.role === 'admin');
  await demoSignIn(page, member.id);
  const image = await page.screenshot({ clip: { x: 0, y: 0, width: 200, height: 80 } });
  await page.getByTestId('report-button').last().click();
  const title = `Image journey: display issue ${Date.now()}`;
  await page.getByTestId('problem-title-input').fill(title);
  await page
    .getByTestId('problem-description-input')
    .fill(
      'The display flickers after waking from sleep. This screenshot shows the symptom on the affected display configuration.',
    );
  await page.getByTestId('problem-product-input').fill('External display');
  await page.getByTestId('problem-setup-input').fill('Windows 11, display firmware 2.1');
  await page
    .getByLabel('Add screenshots')
    .setInputFiles({ name: 'display.png', mimeType: 'image/png', buffer: image });
  await expect(page.locator('.image-previews img')).toBeVisible();
  await page.getByTestId('report-submit').click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const problemId = page.url().split('/').at(-1);
  const picture = page.locator('.attachment-gallery img');
  await expect(picture).toBeVisible();
  await expect
    .poll(() => picture.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  const detail = await (await request.get(`/api/v1/problems/${problemId}`)).json();
  expect(detail.problem.attachments).toHaveLength(1);
  const attachment = detail.problem.attachments[0];
  expect(attachment.mimeType).toBe('image/webp');
  expect(attachment.size).toBeLessThanOrEqual(500 * 1024);
  const hide = await request.post('/api/v1/moderation/content', {
    headers: { Authorization: `Bearer demo:${moderator.id}` },
    data: {
      targetType: 'problem',
      targetId: problemId,
      hidden: true,
      reason: 'Reviewing a screenshot for accidentally shared personal information.',
    },
  });
  expect(hide.ok()).toBeTruthy();
  expect((await request.get(`/api/v1/attachments/${attachment.id}`)).status()).toBe(404);
  await page.evaluate(
    (userId) => localStorage.setItem('tracker.demoToken', `demo:${userId}`),
    moderator.id,
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect
    .poll(() => picture.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
});

test('public discovery, search, and mobile navigation remain usable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByText(/demo/i).first()).toBeVisible();
  await expect(page.getByTestId('report-button').first()).toBeVisible();
  const search = page.getByRole('searchbox');
  await search.fill('Wi-Fi');
  await search.press('Enter');
  await expect(page.getByText(/Wi-Fi/i).first()).toBeVisible();
  await search.fill('no-matching-problem-xyz123');
  await search.press('Enter');
  await expect(page.getByText(/no problems|no matches|nothing found/i).first()).toBeVisible();
  await search.fill('');
  await search.press('Enter');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('main')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test('a failed publish keeps the draft and keyboard focus stays inside sign-in', async ({
  page,
  request,
}) => {
  const config = await (await request.get('/api/v1/config')).json();
  const member = config.demoAccounts.find((p: { role: string }) => p.role === 'member');
  await page.goto('/');
  const opener = page.getByTestId('login-button').last();
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await demoSignIn(page, member.id);
  await page.getByTestId('report-button').last().click();
  const title = `Unsent draft: connection fails ${Date.now()}`;
  await page.getByTestId('problem-title-input').fill(title);
  await page
    .getByTestId('problem-description-input')
    .fill(
      'The network adapter repeatedly disconnects after sleep. This detailed report should remain available if publishing fails.',
    );
  await page.getByTestId('problem-product-input').fill('Network adapter');
  await page.getByTestId('problem-setup-input').fill('Windows 11, adapter driver 1.2');
  await page.route('**/api/v1/problems', async (route) => {
    if (route.request().method() === 'POST') await route.abort('failed');
    else await route.continue();
  });
  await page.getByTestId('report-submit').click();
  await expect(page.getByRole('alert').filter({ hasText: 'hasn’t been saved' })).toBeVisible();
  await expect(page.getByTestId('problem-title-input')).toHaveValue(title);
  await page.reload();
  await expect(page.getByTestId('problem-title-input')).toHaveValue(title);
  await page.unroute('**/api/v1/problems');
});

test('members can confirm, propose, and test a fix before a moderator verifies and resolves it through the website', async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(90000);
  const config = await (await request.get('/api/v1/config')).json();
  const members = config.demoAccounts.filter((p: { role: string }) => p.role === 'member');
  const moderator = config.demoAccounts.find((p: { role: string }) => p.role === 'admin');
  await demoSignIn(page, members[0].id);
  await page.getByTestId('report-button').last().click();
  const title = `Community journey: charging stops ${Date.now()}`;
  const setup = 'Windows 11, USB-C charger firmware 2.1';
  await page.getByTestId('problem-title-input').fill(title);
  await page
    .getByTestId('problem-description-input')
    .fill(
      'Charging stops after waking the laptop from sleep. The charger works before sleep and reconnecting restores charging.',
    );
  await page.getByTestId('problem-product-input').fill('USB-C laptop charger');
  await page.getByTestId('problem-setup-input').fill(setup);
  await page.getByTestId('report-submit').click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const problemUrl = page.url();
  const contributorContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
  const reviewerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
  try {
    const contributor = await contributorContext.newPage();
    await demoSignIn(contributor, members[1].id);
    await contributor.goto(problemUrl);
    await contributor.getByTestId('affected-button').click();
    await contributor.getByRole('dialog').getByLabel('Your setup').fill(setup);
    await contributor.getByRole('button', { name: 'Confirm I’m affected' }).click();
    await expect(contributor.locator('.detail-card .status')).toHaveText('Confirmed');
    await contributor.getByTestId('propose-solution-button').click();
    const fixTitle = `Reconnect charger workaround ${Date.now()}`;
    await contributor.getByTestId('solution-title-input').fill(fixTitle);
    await contributor
      .getByTestId('solution-instructions-input')
      .fill(
        'Save your work. Disconnect the charger, wait ten seconds, reconnect it, and repeat the sleep and wake test three times.',
      );
    await contributor.getByTestId('solution-supported-input').fill(setup);
    await contributor.getByTestId('solution-submit').click();
    await expect(contributor.getByRole('heading', { name: fixTitle })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'I tested this' }).click();
    await page.getByRole('dialog').getByLabel('Tested setup').fill(setup);
    await page
      .getByRole('dialog')
      .getByLabel('Evidence and observations')
      .fill(
        'The charging indicator returned and three sleep cycles completed without a disconnect.',
      );
    await page.getByRole('button', { name: 'Save test result' }).click();
    await expect(page.locator('.test-rate strong')).toHaveText('100%');
    const reviewer = await reviewerContext.newPage();
    await demoSignIn(reviewer, moderator.id);
    await reviewer.goto('/moderation');
    const reviewCard = reviewer
      .locator('.moderation-card')
      .filter({ has: reviewer.getByRole('heading', { name: fixTitle }) });
    await reviewCard.getByRole('button', { name: 'Review & verify' }).click();
    await reviewer
      .getByRole('dialog')
      .getByLabel('Evidence reviewed')
      .fill(
        'Reviewed the independent tester’s three successful sleep and wake cycles on the stated charger firmware.',
      );
    await reviewer
      .getByRole('dialog')
      .getByLabel('Reason for the decision')
      .fill('Independent evidence supports this fix on the reported configuration.');
    await reviewer.getByRole('button', { name: 'Save moderation decision' }).click();
    await expect(reviewer.getByRole('dialog')).toHaveCount(0);
    await reviewer.getByRole('button', { name: 'Problems', exact: true }).click();
    const problemCard = reviewer
      .locator('.moderation-card')
      .filter({ has: reviewer.getByRole('heading', { name: title }) });
    await problemCard.getByRole('button', { name: 'Change status' }).click();
    await reviewer.getByRole('dialog').getByLabel('New status').selectOption('Resolved');
    await reviewer
      .getByRole('dialog')
      .getByLabel('Reason for the decision')
      .fill('The current verified workaround covers the reported device and firmware.');
    await reviewer.getByRole('button', { name: 'Save moderation decision' }).click();
    await expect(reviewer.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.detail-card .status')).toHaveText('Resolved');
    await expect(page.locator('.solution-state')).toContainText('Moderator verified');
  } finally {
    await contributorContext.close();
    await reviewerContext.close();
  }
});

test('a signed-in contributor can publish a structured problem with persistent data', async ({
  page,
  request,
}) => {
  const configResponse = await request.get('/api/v1/config');
  expect(configResponse.ok()).toBeTruthy();
  const config = await configResponse.json();
  expect(config.demo).toBe(true);
  const member = config.demoAccounts.find((p: { role: string }) => p.role === 'member');
  expect(member).toBeTruthy();
  await page.goto('/');
  await page.getByTestId('login-button').first().click();
  await page.getByTestId(`demo-account-${member.id}`).click();
  await page.getByTestId('report-button').first().click();
  const title = `Browser test: USB dock disconnects ${Date.now()}`;
  await page.getByTestId('problem-title-input').fill(title);
  await page
    .getByTestId('problem-description-input')
    .fill(
      'The external USB dock disconnects during a video call after waking the laptop from sleep. This issue can be reproduced repeatedly.',
    );
  await page.getByTestId('problem-product-input').fill('USB-C dock');
  await page.getByTestId('problem-setup-input').fill('Windows 11, USB-C dock firmware 2.1');
  await page.getByTestId('report-submit').click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByTestId('affected-button')).toBeVisible();
  await expect(page.getByTestId('follow-button')).toBeVisible();
});

test('the real API protects counts, verification, revisions, and duplicate merges', async ({
  request,
}) => {
  const config = await (await request.get('/api/v1/config')).json();
  const members = config.demoAccounts.filter((p: { role: string }) => p.role === 'member');
  const reviewer = config.demoAccounts.find(
    (p: { role: string }) => p.role === 'admin' || p.role === 'moderator',
  );
  async function login(userId: string) {
    const response = await request.post('/api/v1/auth/demo', { data: { userId } });
    expect(response.ok()).toBeTruthy();
    return { Authorization: `Bearer ${(await response.json()).token}` };
  }
  const first = await login(members[0].id),
    second = await login(members[1].id),
    mod = await login(reviewer.id);
  const input = {
    title: `Integration: network adapter fails ${Date.now()}`,
    description:
      'The network adapter stops responding immediately after resuming from sleep on this specific driver version.',
    category: 'Networking',
    product: 'Network adapter',
    classification: 'Software',
    setup: 'Windows 11, adapter driver 1.2',
    affected: true,
  };
  const created = await request.post('/api/v1/problems', { headers: first, data: input });
  expect(created.ok()).toBeTruthy();
  const raw = await created.json();
  const problem = raw.problem || raw;
  const pid = problem.id;
  expect(pid).toBeTruthy();
  const anonymousEdit = await request.patch(`/api/v1/problems/${pid}`, { data: input });
  expect(anonymousEdit.status()).toBe(401);
  const unauthorizedEdit = await request.patch(`/api/v1/problems/${pid}`, {
    headers: second,
    data: input,
  });
  expect(unauthorizedEdit.status()).toBe(403);
  const attempts = await Promise.all(
    Array.from({ length: 6 }, () =>
      request.put(`/api/v1/problems/${pid}/participation`, {
        headers: second,
        data: { kind: 'affected', active: true, setup: input.setup },
      }),
    ),
  );
  attempts.forEach((response) => expect(response.ok()).toBeTruthy());
  let detail = await (await request.get(`/api/v1/problems/${pid}`)).json();
  expect(detail.problem.affectedCount).toBe(2);
  expect(detail.problem.status).toBe('Confirmed');
  const solutionInput = {
    title: 'Disable adapter power saving',
    instructions:
      'Open the adapter power settings, record the original configuration, disable power saving, and test sleep and wake again.',
    supportedSetup: input.setup,
    reasoning: 'Checks the wake power state.',
    limitations: 'Only tested with this driver.',
    warnings: 'Save work before restarting.',
  };
  const submitted = await request.post(`/api/v1/problems/${pid}/solutions`, {
    headers: second,
    data: solutionInput,
  });
  expect(submitted.ok()).toBeTruthy();
  const solutionRaw = await submitted.json();
  const solution = solutionRaw.solution || solutionRaw;
  const sid = solution.id,
    revisionId = solution.currentRevision.id;
  expect(
    (
      await request.put(`/api/v1/solutions/${sid}/tests`, {
        headers: first,
        data: {
          revisionId,
          outcome: 'Worked',
          setup: input.setup,
          evidence: 'Reproduced three sleep cycles without disconnects.',
        },
      })
    ).ok(),
  ).toBeTruthy();
  const verification = {
    revisionId,
    evidence: 'Independently reproduced the fix on the affected driver version.',
    supportedScope: input.setup,
    reason: 'Successful test covers the reported configuration.',
    decision: 'verified',
  };
  expect(
    (
      await request.post(`/api/v1/moderation/solutions/${sid}/verify`, {
        headers: second,
        data: verification,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post(`/api/v1/moderation/solutions/${sid}/verify`, {
        headers: mod,
        data: verification,
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.post(`/api/v1/moderation/problems/${pid}/status`, {
        headers: mod,
        data: {
          status: 'Resolved',
          reason: 'Verified current fix covers the affected configuration.',
        },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.patch(`/api/v1/solutions/${sid}`, {
        headers: second,
        data: {
          ...solutionInput,
          instructions:
            solutionInput.instructions + ' Also reconnect the adapter before the final test.',
        },
      })
    ).ok(),
  ).toBeTruthy();
  detail = await (await request.get(`/api/v1/problems/${pid}`)).json();
  const edited = detail.solutions.find((s: { id: string }) => s.id === sid);
  expect(edited.currentRevision.number).toBe(2);
  expect(edited.currentRevision.verification).toBeNull();
  expect(edited.revisions.find((r: { id: string }) => r.id === revisionId).tests).toHaveLength(1);
  expect(detail.problem.verifiedCount).toBe(0);
  const sourceResponse = await request.post('/api/v1/problems', {
    headers: first,
    data: { ...input, title: input.title + ' duplicate' },
  });
  const sourceRaw = await sourceResponse.json();
  const source = sourceRaw.problem || sourceRaw;
  await request.put(`/api/v1/problems/${source.id}/participation`, {
    headers: second,
    data: { kind: 'affected', active: true, setup: input.setup },
  });
  expect(
    (
      await request.post('/api/v1/moderation/merge', {
        headers: mod,
        data: {
          sourceId: source.id,
          targetId: pid,
          reason: 'Same affected product, driver, symptoms, and reproduction.',
        },
      })
    ).ok(),
  ).toBeTruthy();
  detail = await (await request.get(`/api/v1/problems/${pid}`)).json();
  expect(detail.problem.affectedCount).toBe(2);
  expect((await (await request.get(`/api/v1/problems/${source.id}`)).json()).redirectId).toBe(pid);
});
