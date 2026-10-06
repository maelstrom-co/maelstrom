import { expect, test } from '@playwright/test';

test('a newcomer can install all skills and request planning without granting edits', async ({
  page,
}) => {
  await page.goto('/agents/skills/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Build with an agent' }),
  ).toBeVisible();
  await expect(
    page.getByText('Choose Project at the installation scope prompt.'),
  ).toBeVisible();
  for (const agent of ['pi', 'opencode', 'claude-code']) {
    const command = page.locator(`[data-install-agent="${agent}"]`);
    await expect(command).toContainText("--skill '*'");
    await expect(command).toContainText(`--agent ${agent}`);
    await expect(command).toContainText(
      `${new URL(page.url()).origin}/agents/skills/bundle.zip`,
    );
    await expect(command).not.toContainText('--global');
  }
  const plan = page.locator('[data-first-plan]');
  await expect(plan).toContainText('Do not edit files or install packages.');
  await expect(
    page.getByRole('heading', { name: 'Choose your task' }),
  ).toBeVisible();
  await expect(page.locator('[data-task-skill]')).toHaveCount(7);
  for (const card of await page.locator('[data-task-skill]').all()) {
    const procedure = await card.getAttribute('data-task-skill');
    await card.locator('summary').click();
    await expect(card.locator('details pre code')).toContainText(
      `--skill maelstrom ${procedure}`,
    );
    await expect(card.locator('details pre code')).toContainText(
      `${new URL(page.url()).origin}/agents/skills/bundle.zip`,
    );
  }
  await expect(
    page.getByRole('heading', { name: 'Verify discovery' }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'On this page' })
      .getByRole('link', { name: 'Verify discovery' }),
  ).toBeVisible();
});

test('the install and task commands stay usable on a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/agents/skills/');
  await expect(async () => {
    await expect(page.locator('[data-install-agent="pi"]')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }).toPass({ timeout: 5000 });
});

test("returning through client navigation reveals this build's install commands", async ({
  page,
}) => {
  await page.goto('/agents/skills/');
  await expect(page.locator('[data-install-agent="pi"]')).toBeVisible();
  await page.evaluate(() =>
    Object.assign(window, { onboardingNavigationProbe: true }),
  );
  await page
    .getByRole('link', { name: 'standalone prompt library', exact: true })
    .click();
  await expect(page).toHaveURL(/\/agents\/prompts\/$/);
  expect(
    await page.evaluate(() => Reflect.get(window, 'onboardingNavigationProbe')),
  ).toBe(true);
  await page.goBack();
  await expect(page).toHaveURL(/\/agents\/skills\/$/);
  for (const agent of ['pi', 'opencode', 'claude-code']) {
    const command = page.locator(`[data-install-agent="${agent}"]`);
    await expect(command).toBeVisible();
    await expect(command).toContainText(
      `${new URL(page.url()).origin}/agents/skills/bundle.zip`,
    );
  }
});
