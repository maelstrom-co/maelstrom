import { expect, test } from '@playwright/test';

test('explains Tasklane before the key step without horizontal overflow', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/tasks');

  await expect(page).toHaveTitle('Tasklane, powered by Maelstrom');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Tasklane' }),
  ).toBeVisible();
  await expect(page.getByText('Powered by Maelstrom')).toBeVisible();

  const intro = page.getByRole('region', { name: 'About Tasklane' });
  await expect(intro).toContainText(
    'Tasklane is a sample task app with Maelstrom built in.',
  );
  await expect(intro).toContainText(
    'Tasklane, the host app, supplies the Vessels (its views) and the Actions they offer.',
  );
  await expect(intro).toContainText(
    'not a live ClickUp, Jira or Todoist integration',
  );
  await expect(intro).toContainText('Works today:');
  await expect(intro).toContainText('In development:');
  await expect(
    page.getByRole('button', { name: 'Start interactive demo' }),
  ).toBeVisible();
  await expect(page.locator('#tasklane-intent')).toBeVisible();

  const { clientWidth, scrollWidth } = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  expect(errors).toEqual([]);
});

test('keeps the home page title and gives no home link to Tasklane', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).not.toHaveTitle(/Tasklane/);
  await expect(page.locator('a[href="/tasks"]')).toHaveCount(0);
});
