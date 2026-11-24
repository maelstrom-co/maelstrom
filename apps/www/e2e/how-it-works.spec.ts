import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

const EXAMPLE_FILES = [
  'orders.vessel.ts',
  'maelstrom.ts',
  'Dashboard.tsx',
  'engine-response.json',
  'OrdersVessel.tsx',
];

const STEP_COPY = [
  {
    title: 'Describe Your Components',
    body: "Each component gets a Vessel. It declares what the planner can use: the component's variants, the actions each variant offers, and its minimum size.",
  },
  {
    title: 'Create Your Instance',
    body: 'Wire Vessels to components and create a typed Maelstrom instance. One factory call returns the Provider, the Chart, and fully typed hooks.',
  },
  {
    title: 'User Intent',
    body: 'Send a text intent with one call. With the optional voice integration, spoken intents take the same path. Your configured planner proposes a layout and declared actions for the goal.',
  },
  {
    title: 'Engine Validates',
    body: 'The planner receives your declared Vessels, their variants and actions, the current layout, and the Chart dimensions. It proposes an Execution Plan and a layout. The Engine validates that proposal at runtime before your app receives it.',
  },
  {
    title: 'UI Responds',
    body: 'The client applies the validated layout and runs your typed action handlers. TypeScript checks your Vessels and handlers at compile time. The Engine checks planner output at runtime.',
  },
];

const OVERCLAIMING_PHRASES = [
  'entire UI',
  'everything it needs',
  'instantly',
  'precise plan',
  'AI figures out the rest',
  'AI orchestrates',
];

const EM_DASH = '\u2014';

test('HowItWorks advances steps and matching code cards in both scroll directions after resizing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);

  const steps = page.locator('.how-step[data-idx]');
  const activeStep = page.locator('.how-step.active');
  const activeCard = page.locator('.how-code-card.active');
  await expect(steps).toHaveCount(5);

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 1440, height: 600 },
  ]) {
    await page.setViewportSize(viewport);
    const positions = [
      ...[0, 1, 2, 3, 4, 3, 2, 1, 0].map((index) => ({
        index,
        viewportOffset: 0.375,
      })),
      // Jump past the observer's narrow band, landing in the gaps between steps.
      { index: 3, viewportOffset: 0.6 },
      { index: 1, viewportOffset: 0 },
      { index: 4, viewportOffset: 0.6 },
    ];
    for (const { index, viewportOffset } of positions) {
      await steps.nth(index).evaluate((element, offset) => {
        window.scrollTo({
          top:
            window.scrollY +
            element.getBoundingClientRect().top -
            window.innerHeight * offset,
          behavior: 'instant',
        });
      }, viewportOffset);
      await expect(activeStep).toHaveCount(1);
      await expect(activeStep).toHaveAttribute('data-idx', String(index));
      await expect(activeCard).toHaveCount(1);
      await expect(activeCard).toHaveAttribute('data-card', String(index));
    }
  }
});

const readStepProgress = (page: import('@playwright/test').Page) =>
  page.locator('.hs-progress').evaluateAll((tracks) =>
    tracks.map((track) => {
      const bar = track.firstElementChild;
      if (!bar) throw new Error('Missing progress bar');
      return (
        Math.round(
          (bar.getBoundingClientRect().width /
            track.getBoundingClientRect().width) *
            100,
        ) / 100
      );
    }),
  );

const positionSequenceProgress = async (
  page: import('@playwright/test').Page,
  progress: number,
) => {
  await page
    .locator('.how-step[data-idx]')
    .evaluateAll((elements, fraction) => {
      const first = elements[0].getBoundingClientRect();
      const last = elements[elements.length - 1].getBoundingClientRect();
      const bandTop = window.innerHeight * 0.3;
      const bandBottom = window.innerHeight * 0.45;
      const span = last.bottom - first.top + bandBottom - bandTop;
      window.scrollTo({
        top: window.scrollY + first.top + fraction * span - bandBottom,
        behavior: 'instant',
      });
    }, progress);
};

test('Every subtitle bar reflects the same cumulative sequence progress', async ({
  page,
}) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);

    const tracks = page.locator('.hs-progress');
    await expect(tracks).toHaveCount(5);
    await expect(page.locator('.how-progress')).toHaveCount(0);
    for (const track of await tracks.all()) {
      const [trackWidth, textWidth] = await track.evaluate((element) => [
        element.getBoundingClientRect().width,
        element.previousElementSibling?.getBoundingClientRect().width,
      ]);
      expect(trackWidth).toBe(textWidth);
      await expect(track.locator('.hs-progress-bar')).toHaveCSS(
        'transition-duration',
        '0s',
      );
    }

    for (const progress of [0, 0.1, 0.25, 0.5, 0.75, 1, 0.8, 0.4, 0]) {
      await positionSequenceProgress(page, progress);
      await expect
        .poll(() => readStepProgress(page))
        .toEqual(Array(5).fill(progress));
    }

    await positionSequenceProgress(page, 0.5);
    await expect.poll(() => readStepProgress(page)).toEqual(Array(5).fill(0.5));
    const beforeResize = await readStepProgress(page);
    await page.setViewportSize({ ...viewport, height: viewport.height + 200 });
    await expect.poll(() => readStepProgress(page)).not.toEqual(beforeResize);
    const resizedProgress = await readStepProgress(page);
    expect(resizedProgress.every((value) => value === resizedProgress[0])).toBe(
      true,
    );
  }
});

test('HowItWorks code cards show each example file exactly as written', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  await expect(page.locator('.how-code-card[data-example-file]')).toHaveCount(
    EXAMPLE_FILES.length,
  );
  for (const [index, file] of EXAMPLE_FILES.entries()) {
    const source = await readExample(file);

    const card = page.locator(`.how-code-card[data-example-file="${file}"]`);
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute('data-card', String(index));
    await expect(card.locator('.win-bar .title')).toHaveText(file);
    expect(await card.locator('pre.code code').textContent()).toBe(source);

    const mobileBlock = page
      .locator('.how-step[data-idx]')
      .nth(index)
      .locator('.how-code-mobile');
    await expect(mobileBlock.locator('.win-bar .title')).toHaveText(file);
    expect(await mobileBlock.locator('pre.code code').textContent()).toBe(
      source,
    );
  }
});

test('HowItWorks step copy describes what the planner receives without overclaiming', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.locator('#how .section-sub')).toHaveText(
    'Describe the pieces. Maelstrom handles the orchestration.',
  );
  await expect(page.locator('.how-step .hs-title')).toHaveText(
    STEP_COPY.map((step) => step.title),
  );
  await expect(page.locator('.how-step .hs-body')).toHaveText(
    STEP_COPY.map((step) => step.body),
  );
  for (const body of await page
    .locator('.how-step .hs-body')
    .allTextContents()) {
    for (const phrase of OVERCLAIMING_PHRASES) {
      expect(body.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
    expect(body).not.toContain(EM_DASH);
  }
});

// The page renders each example with its trailing newline trimmed.
async function readExample(file: string): Promise<string> {
  const source = await readFile(
    resolve(import.meta.dirname, '../src/examples/how-it-works', file),
    'utf8',
  );
  return source.replace(/\n$/, '');
}
