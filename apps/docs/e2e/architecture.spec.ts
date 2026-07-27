import { expect, type Page, test } from '@playwright/test';

// These assertions exercise what jsdom unit tests cannot: real CSS, hydration,
// layout, and the camera. Each one maps to a requirement of the redesign.
const PAGE = '/understanding/architecture/';

// The island adds `.arch--hydrated` on mount. Gating on it avoids interacting
// with the server-rendered markup before React has attached its handlers.
async function openHydratedDiagram(page: Page) {
  await page.goto(PAGE);
  await expect(page.locator('.arch.arch--hydrated')).toBeAttached();
}

async function centerX(page: Page, id: string) {
  const box = await page.locator(`[data-node-id="${id}"]`).boundingBox();
  return box ? box.x + box.width / 2 : NaN;
}

test.describe('architecture diagram', () => {
  test('mounts with protocol centered between client and engine', async ({
    page,
  }) => {
    await openHydratedDiagram(page);

    const nodes = page.locator('.arch-node');
    await expect(nodes).toHaveCount(5); // island hydrated

    // CSS actually loaded — a node has a real border (caught the unstyled bug).
    const border = await nodes
      .first()
      .evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect(border).not.toBe('0px');

    // The spine: protocol sits horizontally between client and engine.
    const [c, p, e] = [
      await centerX(page, 'client'),
      await centerX(page, 'protocol'),
      await centerX(page, 'engine'),
    ];
    expect(c).toBeLessThan(p);
    expect(p).toBeLessThan(e);

    // Two channel segments + two dependency edges.
    await expect(page.locator('path[data-edge-id]')).toHaveCount(4);
  });

  test('reveals a node role on focus and advances the subtitle', async ({
    page,
  }) => {
    await openHydratedDiagram(page);

    await page.getByRole('button', { name: /protocol/ }).focus();
    await expect(page.locator('.arch-detail')).toContainText(
      'message contract',
    );

    await page.getByRole('button', { name: 'Next step' }).click();
    await expect(page.locator('.arch-subtitle')).toContainText('ChartRequest');
  });

  test('the camera reframes between beats', async ({ page }) => {
    await openHydratedDiagram(page);
    const camera = page.locator('.arch-camera');
    const intentTransform = await camera.evaluate(
      (el) => getComputedStyle(el).transform,
    );

    // intent -> request -> decide; the camera zooms to the engine.
    await page.getByRole('button', { name: 'Next step' }).click();
    await page.getByRole('button', { name: 'Next step' }).click();
    await expect(page.locator('.arch')).toHaveAttribute('data-step', 'decide');

    // Let the CSS transition settle, then confirm the framing changed.
    await page.waitForTimeout(1300);
    const decideTransform = await camera.evaluate(
      (el) => getComputedStyle(el).transform,
    );
    expect(decideTransform).not.toBe(intentTransform);
  });

  test('beams animate under prefers-reduced-motion (motion is content)', async ({
    browser,
  }) => {
    // The flowing beams convey the architecture, so motion is intentionally NOT
    // gated on the OS reduced-motion preference. This guards that decision.
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await openHydratedDiagram(page);

    await page.getByRole('button', { name: 'Next step' }).click(); // -> request
    await expect(page.locator('.arch')).toHaveAttribute('data-step', 'request');

    await expect(page.locator('.arch-flow--active')).toHaveCount(2);
    await expect(page.locator('.arch-packet')).toHaveCount(1);
    const animationName = await page
      .locator('.arch-flow--active')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(animationName).toBe('arch-flow');

    await context.close();
  });

  test('the detail toggle hides the field chips', async ({ page }) => {
    await openHydratedDiagram(page);

    // The intent beat shows field chips by default.
    await expect(page.locator('.arch-detail__fields')).toBeVisible();
    await page.getByRole('button', { name: /hide details/i }).click();
    await expect(page.locator('.arch-detail__fields')).toHaveCount(0);
  });
});
