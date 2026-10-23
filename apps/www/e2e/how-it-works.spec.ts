import { expect, test } from '@playwright/test';

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
