import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { parseFrontmatter } from 'astro/markdown';
import { installPostHogRecorder } from './posthog';

test('the default setup copies the canonical stable prompt without page metadata', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const captures = await installPostHogRecorder(page);
  await page.goto('/');
  await expect(
    page.getByRole('tab', { name: 'With your agent', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await page
    .getByRole('button', { name: 'Copy integration prompt', exact: true })
    .click();
  const expected = parseFrontmatter(
    await readFile(
      resolve(
        import.meta.dirname,
        '../../docs/prompts/library/maelstrom-project-onboarding.md',
      ),
      'utf8',
    ),
  );
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(expected.content.replace(/^\r?\n/, ''));
  expect(expected.frontmatter).toMatchObject({
    compatibility: { sdk: { '@maelstrom-co/react': '0.1.0' } },
  });
  await expect
    .poll(() => captures)
    .toEqual([
      {
        event: 'setup_copied',
        properties: { method: 'prompt', source: 'hero' },
      },
    ]);
});

test('keyboard users can choose skills and manual setup and copy the selected command', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const first = page.getByRole('tab', { name: 'With your agent', exact: true });
  await first.focus();
  await first.press('ArrowRight');
  const skills = page.getByRole('tab', { name: 'Agent skills', exact: true });
  await expect(skills).toBeFocused();
  await expect(skills).toHaveAttribute('aria-selected', 'true');
  await page
    .getByRole('button', { name: 'Copy skill install command', exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(
      "bunx skills@1.7.0 add https://docs.maelstrom-ai.co/agents/skills/bundle.zip --skill '*' --copy",
    );
  await skills.focus();
  await skills.press('End');
  await page
    .getByRole('button', { name: 'Copy install command', exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('npm install @maelstrom-co/react');
});

test('a failed copy offers the source and does not record a successful setup action', async ({
  page,
}) => {
  const captures = await installPostHogRecorder(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('Clipboard unavailable');
        },
      },
    }),
  );
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Copy integration prompt', exact: true })
    .click();
  await expect(
    page.getByText('Copy failed — select the command and copy manually'),
  ).toBeAttached();
  await page.getByText('Read the prompt', { exact: true }).click();
  await expect(page.locator('#setup-panel-prompt pre')).toContainText(
    'Requested authority:',
  );
  expect(captures).toEqual([]);
});

test('new onboarding links record intent without activating external services', async ({
  page,
}) => {
  const captures = await installPostHogRecorder(page);
  await page.goto('/');
  for (const source of ['hero', 'navigation']) {
    const link = page.locator(`[data-start-source="${source}"]`);
    await expect(link).toHaveAttribute('href', '/#get-started');
    await link.click();
  }
  for (const source of ['demo_section', 'navigation', 'footer']) {
    const playground = page.locator(`[data-playground-source="${source}"]`);
    await playground.evaluate((link) =>
      link.addEventListener('click', (event) => event.preventDefault()),
    );
    await playground.click();
  }
  await expect
    .poll(() => captures)
    .toEqual([
      { event: 'get_started_clicked', properties: { source: 'hero' } },
      { event: 'get_started_clicked', properties: { source: 'navigation' } },
      { event: 'playground_opened', properties: { source: 'demo_section' } },
      { event: 'playground_opened', properties: { source: 'navigation' } },
      { event: 'playground_opened', properties: { source: 'footer' } },
    ]);
});

test('manual setup and readable prompt remain available without JavaScript', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Set up the SDK yourself' }),
    ).toBeVisible();
    await expect(page.locator('#setup-panel-npm')).toContainText(
      'npm install @maelstrom-co/react',
    );
    await page.getByText('Read the prompt', { exact: true }).click();
    await expect(page.locator('#setup-panel-prompt pre')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await context.close();
  }
});
