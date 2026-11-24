import { expect, test } from '@playwright/test';

const HEADLINE_WIDTHS = [390, 360, 1280];

// 981px and 1024px are the narrowest two-column layouts, where the bar is
// tighter than on a phone.
const BROWSER_BAR_WIDTHS = [390, 981, 1024, 1280];

for (const width of HEADLINE_WIDTHS) {
  test(`hero headline reads as three unwrapped lines at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);

    const heading = page.locator('h1.hero-h1');
    await expect(heading).toHaveText('Maelstrom turns intent into action.');

    const lines = heading.locator('.line');
    await expect(lines).toHaveCount(3);
    await expect(lines.nth(1)).toHaveClass(/accent/);

    const layout = await heading.evaluate((element) => {
      const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
      return {
        lineHeight,
        rows: Array.from(element.querySelectorAll('.line')).map((line) => {
          const box = line.getBoundingClientRect();
          return { top: box.top, height: box.height };
        }),
      };
    });

    const tops = layout.rows.map((row) => row.top);
    expect(new Set(tops).size, 'each line sits on its own row').toBe(3);
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    for (const row of layout.rows) {
      expect(row.height, 'no line wraps onto a second row').toBeLessThan(
        layout.lineHeight * 1.5,
      );
    }
  });
}

test('hero badge says scripted preview and nothing claims to be live', async ({
  page,
}) => {
  await page.goto('/');

  const pill = page.locator('.hero-right .preview-pill:visible');
  await expect(pill).toHaveCount(1);
  await expect(pill).toHaveText(/scripted preview/i);
  await expect(page.locator('.hero-right .preview-dot:visible')).toHaveCount(1);
  await expect(page.locator('.live-pill')).toHaveCount(0);

  const exactLiveLabels = await page
    .locator('.hero *')
    .evaluateAll(
      (elements) =>
        elements.filter((element) => element.textContent?.trim() === 'LIVE')
          .length,
    );
  expect(exactLiveLabels).toBe(0);
});

test('hero caption marks the health values as illustrative and is readable by assistive technology', async ({
  page,
}) => {
  await page.goto('/');

  const caption = page.locator('.hero-demo-note');
  await expect(caption).toBeVisible();
  await expect(caption).toContainText(/illustrative/i);

  const hasHiddenAncestor = await caption.evaluate(
    (element) => element.closest('[aria-hidden="true"]') !== null,
  );
  expect(hasHiddenAncestor).toBe(false);
});

for (const width of BROWSER_BAR_WIDTHS) {
  test(`hero badge and prompt both fit inside the browser bar at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);

    const bar = page.locator('.hero-right .hero-dash-bar:visible');
    await expect(bar).toHaveCount(1);
    await expect(bar).toBeVisible();

    const fit = await bar.evaluate((element) => {
      const barBox = element.getBoundingClientRect();
      const inside = (selector: string) => {
        const target = element.querySelector(selector);
        if (!target) return false;
        const box = target.getBoundingClientRect();
        return (
          box.width > 0 &&
          box.left >= barBox.left - 0.5 &&
          box.right <= barBox.right + 0.5
        );
      };
      return {
        overflows: element.scrollWidth > element.clientWidth,
        pillInside: inside('.preview-pill'),
        promptInside: inside('.hero-prompt'),
      };
    });

    expect(fit.overflows, 'bar has no horizontal overflow').toBe(false);
    expect(fit.pillInside, 'pill is fully inside the bar').toBe(true);
    expect(fit.promptInside, 'prompt is fully inside the bar').toBe(true);
  });
}

test('lower demo describes scripted planner responses honestly', async ({
  page,
}) => {
  await page.goto('/');

  const demo = page.locator('section#demo');
  await expect(demo.locator('.eyebrow')).toHaveText('Try the scripted demo');

  const text = (await demo.locator('.how-head').innerText()).toLowerCase();
  expect(text).toContain('scripted');
  expect(text).toContain('no model calls');
  expect(text).not.toContain('pre-recorded');
  expect(text).not.toContain('ai responses');
  expect(text).not.toContain('experience the engine');
});

test('meta description calls voice optional and has no semicolon', async ({
  page,
}) => {
  await page.goto('/');

  const description = await page
    .locator('meta[name="description"]')
    .getAttribute('content');
  expect(description).toContain('optional');
  expect(description).not.toContain(';');
});
