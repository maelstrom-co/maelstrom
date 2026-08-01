import { expect, type Page, test } from '@playwright/test';

// jsdom proves the state machine; only a real browser proves the layout claim,
// which rides entirely on Starlight's own CSS variables.
const PAGE = '/getting-started/introduction/';
const SIDEBAR = '#starlight__sidebar';
const HTML = 'html';

async function collapse(page: Page) {
  await page.locator('[data-sidebar-toggle="collapse"]').click();
  await expect(page.locator(HTML)).toHaveAttribute(
    'data-sidebar-collapsed',
    'true',
  );
}

test.describe('sidebar focus mode', () => {
  test('collapsing hides the sidebar and re-centers the article', async ({
    page,
  }) => {
    await page.goto(PAGE);
    await expect(page.locator(SIDEBAR)).toBeVisible();

    await collapse(page);
    await expect(page.locator(SIDEBAR)).toBeHidden();

    // The point of focus mode: the article takes the middle of the window
    // rather than staying where the sidebar left it.
    //
    // The bound is 40px, not 0: Starlight's own `--sl-content-margin-inline:
    // auto 0` hugs the article against the ToC rather than centering it, which
    // leaves a constant `--sl-content-pad-x` residual (~32px) at every
    // viewport width once `--sl-sidebar-width` is zero. That residual is
    // Starlight's own layout, not slack in this test. The formula is
    // `--sl-sidebar-width / 2 + --sl-content-pad-x`, so 40px still catches the
    // failure this assertion exists for: a sidebar width that fails to reach
    // zero puts the offset near 182px (150px from the half-sidebar term
    // alone), nowhere near this threshold.
    const box = await page
      .locator('.sl-markdown-content')
      .first()
      .boundingBox();
    const viewport = await page.evaluate(
      () => document.documentElement.clientWidth,
    );
    expect(box).not.toBeNull();
    const center = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    expect(Math.abs(center - viewport / 2)).toBeLessThan(40);

    // Starlight sizes the right ToC from the same variable focus mode zeroes.
    // Without the pin in sidebar.css this column collapses to nothing.
    const toc = await page
      .locator('.right-sidebar-panel .sl-container')
      .boundingBox();
    expect(toc?.width ?? 0).toBeGreaterThan(150);
  });

  // The spec deliberately chose to remove clutter rather than widen the
  // measure: focus mode must never let lines run longer than Starlight's own
  // 52rem cap. Both directions of the check matter, and for different
  // reasons. Exceeding the cap means focus mode lengthened lines, which the
  // spec rejected. Failing to reach it means the sidebar's space was never
  // reclaimed — the feature's headline effect not happening at all — and
  // `before < after` alone cannot catch that: if a future change breaks the
  // reclaim mechanism while the sidebar still hides and the article still
  // centres, `before === after` and a merely-non-decreasing bound would pass
  // silently. Asserting the collapsed width equals the cap catches both.
  test('focus mode does not lengthen lines past the 52rem cap', async ({
    page,
  }) => {
    await page.goto(PAGE);
    const cap = await page.evaluate(() => {
      const root = document.documentElement;
      const width =
        getComputedStyle(root).getPropertyValue('--sl-content-width');
      return parseFloat(width) * parseFloat(getComputedStyle(root).fontSize);
    });
    const before = await page
      .locator('.sl-markdown-content')
      .first()
      .boundingBox();
    // Proves the expanded state is the constrained one — otherwise the
    // "reaches the cap" assertion below would be trivially true.
    expect(before?.width ?? 0).toBeLessThan(cap);

    await collapse(page);
    // sidebar.css transitions .main-pane's width over 0.2s; collapse() only
    // waits for the attribute flip, not the animation, so polling the delta
    // itself — rather than sleeping a fixed duration or reading immediately —
    // is what makes this measure the settled width instead of a
    // mid-transition one, while still asserting the same two-sided bound.
    await expect
      .poll(async () => {
        const box = await page
          .locator('.sl-markdown-content')
          .first()
          .boundingBox();
        return Math.abs((box?.width ?? 0) - cap);
      })
      .toBeLessThan(2);
  });

  test('the floating button restores the sidebar', async ({ page }) => {
    await page.goto(PAGE);
    await collapse(page);

    await page.locator('[data-sidebar-toggle="expand"]').click();
    await expect(page.locator(HTML)).not.toHaveAttribute(
      'data-sidebar-collapsed',
      'true',
    );
    await expect(page.locator(SIDEBAR)).toBeVisible();
  });

  test('Mod+B toggles focus mode', async ({ page }) => {
    await page.goto(PAGE);

    await page.keyboard.press('ControlOrMeta+b');
    await expect(page.locator(HTML)).toHaveAttribute(
      'data-sidebar-collapsed',
      'true',
    );

    await page.keyboard.press('ControlOrMeta+b');
    await expect(page.locator(HTML)).not.toHaveAttribute(
      'data-sidebar-collapsed',
      'true',
    );
  });

  test('the collapsed state survives a reload', async ({ page }) => {
    await page.goto(PAGE);
    await collapse(page);

    await page.reload();
    await expect(page.locator(HTML)).toHaveAttribute(
      'data-sidebar-collapsed',
      'true',
    );
    await expect(page.locator(SIDEBAR)).toBeHidden();
  });

  // Astro's ClientRouter overwrites <html> attributes on swap, so without the
  // astro:after-swap hook the sidebar pops back on the first in-article link.
  test('the collapsed state survives client-side navigation', async ({
    page,
  }) => {
    await page.goto(PAGE);
    await collapse(page);

    await page.locator('.pagination-links a[rel="next"]').click();
    await expect(page).not.toHaveURL(new RegExp(`${PAGE}$`));
    await expect(page.locator(HTML)).toHaveAttribute(
      'data-sidebar-collapsed',
      'true',
    );
    await expect(page.locator(SIDEBAR)).toBeHidden();
  });

  // Regression guard for a real defect: the collapsed ToC width is clamped by
  // `min(constant, (100vw - content-width)/2 - padding)`, and `100vw` includes
  // the scrollbar while the actual gutter does not. Just above the 72rem
  // two-column breakpoint the margin from that clamp is only ~9.5px, so a
  // regression there spills the ToC off-screen with no scrollbar to reach it.
  test('the ToC stays on screen at the tightest gutter width', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1153, height: 720 });
    await page.goto(PAGE);
    await collapse(page);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBe(overflow.clientWidth);

    const toc = await page
      .locator('.right-sidebar-panel .sl-container')
      .boundingBox();
    expect(toc).not.toBeNull();
    const tocRightEdge = (toc?.x ?? 0) + (toc?.width ?? 0);
    expect(tocRightEdge).toBeLessThanOrEqual(overflow.clientWidth);
  });
});
