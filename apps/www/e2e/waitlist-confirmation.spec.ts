import { expect, test } from '@playwright/test';

const RESULT_PAGES = [
  `/waitlist/confirm/?token=${'a'.repeat(43)}`,
  '/waitlist/confirmed/',
  '/waitlist/invalid/',
];

const readPaintOrder = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const shell = document.querySelector('.result-shell');
    const shader = document.querySelector('#mae-shader');
    return {
      shell:
        Number.parseInt(shell ? getComputedStyle(shell).zIndex : '0', 10) || 0,
      shader:
        Number.parseInt(shader ? getComputedStyle(shader).zIndex : '0', 10) ||
        0,
    };
  });

for (const path of RESULT_PAGES) {
  test(`waitlist result content paints above the shader on ${path}`, async ({
    page,
  }) => {
    await page.goto(path);

    const shell = page.locator('.result-shell');
    const card = page.locator('.result-card');
    await expect(shell).toBeVisible();
    await expect(card.getByRole('heading')).toBeVisible();
    await expect(shell).toHaveCSS('position', 'relative');
    await expect(shell).toHaveCSS('z-index', '2');
    await expect(card).toHaveCSS('border-top-style', 'solid');
    await expect(card).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const paintOrder = await readPaintOrder(page);
    expect(paintOrder.shell).toBeGreaterThan(paintOrder.shader);
  });
}

test('confirmation content remains visible without overflow on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/waitlist/confirm/?token=${'a'.repeat(43)}`);

  await expect(
    page.getByRole('heading', { name: 'Confirm your email' }),
  ).toBeVisible();
  const paintOrder = await readPaintOrder(page);
  expect(paintOrder.shell).toBeGreaterThan(paintOrder.shader);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
