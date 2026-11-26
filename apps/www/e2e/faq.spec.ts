import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

for (const width of [390, 1280]) {
  test(`visitors can read every FAQ answer at ${width}px without JavaScript`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      javaScriptEnabled: false,
      viewport: { width, height: 844 },
    });
    try {
      const page = await context.newPage();
      await page.goto('/');
      const questions = page.locator('.faq-q');
      await expect(questions).toHaveCount(7);
      await expect(page.locator('#faq-a-0')).toBeVisible();
      for (let index = 1; index < 7; index++) {
        const question = page.locator(`#faq-q-${index}`);
        const answer = page.locator(`#faq-a-${index}`);
        await question.press('Enter');
        await expect(answer).toBeVisible();
        await expect(answer).not.toBeEmpty();
        await expect(page.locator('#faq-a-0')).toBeHidden();
        await question.press('Enter');
        await expect(answer).toBeHidden();
      }
    } finally {
      await context.close();
    }
  });
}

test('keyboard users can move between FAQ questions and close an answer', async ({
  page,
}) => {
  await page.goto('/');
  const first = page.locator('#faq-q-0');
  await first.focus();
  await first.press('ArrowDown');
  const second = page.locator('#faq-q-1');
  await expect(second).toBeFocused();
  await second.press('Enter');
  await expect(page.locator('#faq-a-1')).toBeVisible();
  await second.press('Escape');
  await expect(page.locator('#faq-a-1')).toBeHidden();
  await second.press('End');
  await expect(page.locator('#faq-q-6')).toBeFocused();
  await page.locator('#faq-q-6').press('Home');
  await expect(first).toBeFocused();
});

test('the generative UI answer explains the closed-world bet, keeps voice and text, and links to docs', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#faq-q-1').click();
  const answer = page.locator('#faq-a-1');
  await expect(answer).toBeVisible();
  await expect(answer).toContainText('never generates components or markup');
  await expect(answer).toContainText('voice or text');
  const docsLink = answer.locator('a');
  await expect(docsLink).toHaveAttribute(
    'href',
    'https://docs.maelstrom-ai.co/understanding/why-maelstrom/',
  );
});

test('the starter answer bounds what the deterministic planner verifies', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#faq-q-2').click();
  const answer = page.locator('#faq-a-2');
  await expect(answer).toBeVisible();
  await expect(answer).toContainText('does not test live model behavior');
  await expect(answer).toContainText('no model call');
});

test('the stability answer shows the version from the published version pin', async ({
  page,
}) => {
  const pin = JSON.parse(
    await readFile(
      resolve(
        import.meta.dirname,
        '../../docs/tools/skills/published-examples/package.json.template',
      ),
      'utf8',
    ),
  ) as { dependencies: Record<string, string> };
  const version = pin.dependencies['@maelstrom-co/react'];
  await page.goto('/');
  await page.locator('#faq-q-5').click();
  const answer = page.locator('#faq-a-5');
  await expect(answer).toBeVisible();
  await expect(answer).toContainText(`Current packages: ${version}`);
  await expect(answer).toContainText('still 0.x and subject to change');
  await expect(answer).not.toContainText('0.1.0');
});
