import { expect, test } from '@playwright/test';

test('layout and view changes preserve app-owned data, and resize never repeats an action', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (new URL(request.url()).hostname !== '127.0.0.1')
      external.push(request.url());
  });
  await page.goto('/');
  const tasks = page.getByRole('region', { name: 'Tasks', exact: true });
  const notes = page.getByRole('region', { name: 'Launch note', exact: true });
  await expect(tasks).toBeVisible();
  await expect(notes).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Send request', exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Rearrange the workspace', exact: true })
    .click();
  const editor = page.getByRole('textbox', {
    name: 'Launch note',
    exact: true,
  });
  await expect(editor).toBeVisible();
  if (testInfo.project.name === 'desktop') {
    await expect
      .poll(async () => {
        const a = await tasks.boundingBox();
        const b = await notes.boundingBox();
        return a !== null && b !== null && b.width > a.width;
      })
      .toBe(true);
  }
  await editor.fill('Keep this note through every layout change.');
  const completed = tasks.getByRole('checkbox', {
    name: 'Try a layout change',
    exact: true,
  });
  await completed.check();
  await page
    .getByRole('button', { name: 'Run an action', exact: true })
    .click();
  await expect(
    tasks.getByRole('checkbox', { name: 'Prepare the launch', exact: true }),
  ).toHaveCount(1);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(async () => {
      const a = await tasks.boundingBox();
      const b = await notes.boundingBox();
      return a !== null && b !== null && b.y >= a.y + a.height - 1;
    })
    .toBe(true);
  await expect(editor).toHaveValue(
    'Keep this note through every layout change.',
  );
  await expect(
    tasks.getByRole('checkbox', { name: 'Prepare the launch', exact: true }),
  ).toHaveCount(1);
  await page
    .getByRole('button', { name: 'Restore the layout', exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await expect(notes).toContainText(
    'Keep this note through every layout change.',
  );
  await expect(completed).toBeChecked();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
