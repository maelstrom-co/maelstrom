import { expect, type Page, test } from '@playwright/test';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

async function copyPage(page: Page): Promise<string> {
  const button = page.getByRole('button', {
    name: 'Copy for AI as markdown',
    exact: true,
  });
  await button.click();
  await expect(button).toContainText('Copied!');
  return page.evaluate(() => navigator.clipboard.readText());
}

test('copied guides keep source links and still work after client navigation', async ({
  page,
}) => {
  await page.goto('/getting-started/introduction/');
  await expect(page.locator('.sl-markdown-content')).toContainText(
    'an open-source framework for building intent-driven apps',
  );

  const introduction = await copyPage(page);
  expect(introduction).toContain('# Introduction');
  expect(introduction).toContain(
    `[Quick Start](${new URL('/getting-started/quick-start', page.url()).href})`,
  );
  expect(introduction).toContain('```tsx');
  expect(introduction).toContain('const m = createMaelstrom({');
  expect(introduction).toContain('**React**');
  expect(introduction).toContain('**Vanilla JS**');
  expect(introduction).not.toContain('#tab-panel-');
  expect(introduction).toContain(
    "from '@maelstrom-co/react';\n\nconst m = createMaelstrom({",
  );

  const documentStart = await page.evaluate(() => performance.timeOrigin);

  await page
    .locator('.sl-markdown-content')
    .getByRole('link', { name: 'Core Concepts', exact: true })
    .click();
  await page.waitForURL(/\/getting-started\/core-concepts\/?$/);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStart);

  const concepts = await copyPage(page);
  expect(concepts).toContain(`# Core Concepts\nSource: ${page.url()}`);
  expect(concepts).toContain('```typescript');
});

test('copied protocol tables retain the envelope and result relationships', async ({
  page,
}) => {
  await page.goto('/understanding/protocol/');

  const markdown = await copyPage(page);
  expect(markdown).toMatch(
    /\|\s*Client envelope\s*\|\s*Engine result\s*\|\s*Server envelope\s*\|/,
  );
  expect(markdown).toMatch(
    /\|\s*`chart_request`\s*\|\s*Successful `chart_response`\s*\|\s*`engine\.maelstrom\.response`/,
  );
  expect(markdown).toContain(new URL('/understanding/engine', page.url()).href);
});
