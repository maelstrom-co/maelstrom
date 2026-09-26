import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { promptLabel } from '../../../../src/lib/prompt-presentation';
import { loadPromptLibrary } from '../../../../tools/prompts/library';

const baseUrl = 'http://127.0.0.1:4317';
const outputDirectory = import.meta.dir;
const prompts = await loadPromptLibrary(
  join(import.meta.dir, '../../../../prompts/library'),
);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 390, height: 844 },
});
await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
  origin: baseUrl,
});
const page = await context.newPage();

try {
  for (const prompt of prompts) {
    const { id, prompt_version: version } = prompt.metadata;
    const response = await page.goto(`${baseUrl}/agents/prompts/${id}/`);
    if (response?.status() !== 200)
      throw new Error(`${id}: detail route failed`);
    if ((await page.getByRole('main').count()) !== 1)
      throw new Error(`${id}: expected exactly one main landmark`);
    const pageHeadings = await page
      .getByRole('heading', { level: 1 })
      .allTextContents();
    if (pageHeadings.length !== 1 || pageHeadings[0] !== promptLabel(id))
      throw new Error(`${id}: Starlight page title is missing or duplicated`);
    const encodedBody = await page
      .locator('[data-prompt-root]')
      .getAttribute('data-prompt-body');
    if (
      !encodedBody ||
      Buffer.from(encodedBody, 'base64').toString('utf8') !== prompt.body
    ) {
      throw new Error(
        `${id}: raw body transport differs from the canonical source`,
      );
    }
    const rendered = page.locator('[data-rendered-prompt]');
    if ((await rendered.locator('h2, h3').count()) === 0)
      throw new Error(`${id}: Markdown headings were not rendered`);
    if ((await rendered.locator('ul, ol').count()) === 0)
      throw new Error(`${id}: Markdown lists were not rendered`);
    if (
      ['maelstrom-react-inventory', 'maelstrom-vessel-modeling'].includes(id) &&
      (await rendered.locator('table').count()) === 0
    ) {
      throw new Error(`${id}: Markdown table was not rendered`);
    }
    if ((await rendered.locator('.metadata').count()) !== 0)
      throw new Error(`${id}: page metadata leaked into the rendered body`);
    const metadata = await page.locator('.metadata').innerText();
    if (
      !metadata.includes(id) ||
      !metadata.includes(version) ||
      !metadata.includes('@maelstrom-co/react')
    ) {
      throw new Error(`${id}: required metadata is missing`);
    }
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      )
    ) {
      throw new Error(`${id}: mobile viewport has horizontal overflow`);
    }

    const copy = page.getByRole('button', { name: 'Copy Markdown' });
    await copy.focus();
    if (!(await copy.evaluate((element) => element === document.activeElement)))
      throw new Error(`${id}: copy button did not receive keyboard focus`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () =>
        document.querySelector('[role="status"]')?.textContent ===
        'Prompt copied.',
    );
    if (
      (await page.evaluate(() => navigator.clipboard.readText())) !==
      prompt.body
    )
      throw new Error(
        `${id}: clipboard content differs from the canonical body`,
      );

    const downloadButton = page.getByRole('button', { name: 'Download .md' });
    await downloadButton.focus();
    if (
      !(await downloadButton.evaluate(
        (element) => element === document.activeElement,
      ))
    ) {
      throw new Error(`${id}: download button did not receive keyboard focus`);
    }
    const downloadEvent = page.waitForEvent('download');
    await page.keyboard.press('Enter');
    const download = await downloadEvent;
    const filename = `${id}-v${version}.md`;
    if (download.suggestedFilename() !== filename)
      throw new Error(`${id}: unexpected download filename`);
    const artifact = join(outputDirectory, 'browser', `${id}.md`);
    await download.saveAs(artifact);
    const bytes = await readFile(artifact);
    if (!bytes.equals(Buffer.from(prompt.body, 'utf8')))
      throw new Error(`${id}: downloaded bytes differ from the canonical body`);
    if (id === 'maelstrom-project-onboarding') {
      await page.screenshot({
        path: join(outputDirectory, 'browser/onboarding-detail-mobile.png'),
        fullPage: true,
      });
    }
    console.log(
      `${id}: raw body transport, rendered Markdown, metadata separation, keyboard copy/download and exact bytes passed; ${filename}; ${bytes.length} bytes; sha256=${createHash('sha256').update(bytes).digest('hex')}`,
    );
  }

  const index = await page.goto(`${baseUrl}/agents/prompts/`);
  if (index?.status() !== 200) throw new Error('Prompt index route failed');
  if ((await page.getByRole('main').count()) !== 1)
    throw new Error('Prompt index must have exactly one main landmark');
  const indexHeadings = await page
    .getByRole('heading', { level: 1 })
    .allTextContents();
  if (indexHeadings.length !== 1 || indexHeadings[0] !== 'Agent prompts')
    throw new Error('Prompt index Starlight title is missing or duplicated');
  for (const prompt of prompts) {
    const route = `/agents/prompts/${prompt.metadata.id}/`;
    if ((await page.locator(`a[href="${route}"]`).count()) !== 1)
      throw new Error(`${route}: index link missing`);
  }
  await page.screenshot({
    path: join(outputDirectory, 'browser/prompt-index-mobile.png'),
    fullPage: true,
  });
  for (const path of [
    'getting-started/quick-start',
    'guides/react/creating-vessels',
    'guides/react/error-handling',
  ]) {
    const response = await page.goto(`${baseUrl}/${path}/`);
    if (response?.status() !== 200)
      throw new Error(`${path}: guide route failed`);
    for (const link of await page
      .locator('a[href^="/agents/prompts/"]')
      .all()) {
      const href = await link.getAttribute('href');
      if (
        !href ||
        (await page.request.get(`${baseUrl}${href}`)).status() !== 200
      )
        throw new Error(`${path}: prompt link ${href} did not resolve`);
    }
  }
  console.log(
    `PASS: Chromium ${browser.version()}, 390x844 viewport; ${prompts.length} detail routes, index routes, and guide prompt links verified.`,
  );
} finally {
  await browser.close();
}
