import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

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
    if (
      (await page
        .locator('pre code')
        .evaluate((element) => element.textContent)) !== prompt.body
    ) {
      throw new Error(`${id}: rendered body differs from the canonical source`);
    }
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
      `${id}: body, metadata, keyboard copy/download and exact bytes passed; ${filename}; ${bytes.length} bytes; sha256=${createHash('sha256').update(bytes).digest('hex')}`,
    );
  }

  const index = await page.goto(`${baseUrl}/agents/prompts/`);
  if (index?.status() !== 200) throw new Error('Prompt index route failed');
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
