import { expect, type Page, test } from '@playwright/test';

// jsdom proves the state machine; only a real browser proves the layout claim,
// which rides entirely on Starlight's own CSS variables.
const PAGE = '/getting-started/introduction/';
const SIDEBAR = '#starlight__sidebar';
const HTML = 'html';
const READY = 'data-sidebar-collapse-ready';

async function waitForSidebarReady(page: Page) {
  await expect(page.locator(HTML)).toHaveAttribute(READY, 'true');
}

async function gotoPage(page: Page, path = PAGE) {
  await page.goto(path);
  await waitForSidebarReady(page);
}

async function collapse(page: Page) {
  await waitForSidebarReady(page);
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
    await gotoPage(page);
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
    await gotoPage(page);
    // Measured, not converted: reading the custom property and multiplying by
    // the root font size would silently assume the value is declared in `rem`
    // and break if Starlight ever moves it to `px` or `ch`.
    const cap = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.width = 'var(--sl-content-width)';
      probe.style.position = 'absolute';
      document.documentElement.append(probe);
      const width = probe.getBoundingClientRect().width;
      probe.remove();
      return width;
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
    await gotoPage(page);
    await collapse(page);

    await page.locator('[data-sidebar-toggle="expand"]').click();
    await expect(page.locator(HTML)).not.toHaveAttribute(
      'data-sidebar-collapsed',
      'true',
    );
    await expect(page.locator(SIDEBAR)).toBeVisible();
  });

  test('Mod+B toggles focus mode', async ({ page }) => {
    await gotoPage(page);

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
    await gotoPage(page);
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
    await gotoPage(page);
    await collapse(page);

    await page.locator('.pagination-links a[rel="next"]').click();
    await expect(page).not.toHaveURL(new RegExp(`${PAGE}$`));
    await expect(page.locator(HTML)).toHaveAttribute(
      'data-sidebar-collapsed',
      'true',
    );
    await expect(page.locator(SIDEBAR)).toBeHidden();

    // The restore must be instant, not animated. applyStoredState re-adds the
    // attribute with no animating marker, so no transition may be installed on
    // the incoming pane — otherwise the sidebar slides out again on every page
    // a reader visits in focus mode. Today an ungated transition happens not
    // to fire (the incoming pane is never styled expanded first), so asserting
    // the absence of the transition is what makes this hold by construction
    // rather than by timing.
    const duration = await page
      .locator(SIDEBAR)
      .evaluate((pane) => getComputedStyle(pane).transitionDuration);
    expect(duration).toBe('0s');
  });

  // The pre-paint inline script in Head.astro is the only thing standing
  // between a returning reader and a flash of the expanded sidebar. Nothing
  // else here fails if it is deleted: every other test waits through the module
  // script, which sets the same attribute a beat later. Blocking external
  // scripts is what isolates the inline one — inline scripts issue no request,
  // so they still run.
  test('the pre-paint script alone restores focus mode', async ({ page }) => {
    await gotoPage(page);
    await collapse(page);

    await page.route('**/*', (route) =>
      route.request().resourceType() === 'script'
        ? route.abort()
        : route.continue(),
    );
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.locator(HTML)).toHaveAttribute(
      'data-sidebar-collapsed',
      'true',
    );
  });

  // Starlight renders the header — and with it the floating expand button — on
  // pages that have no sidebar. The 404 route is the reachable one: it renders
  // as a splash page, so `hasSidebar` is false, the collapse button is never
  // mounted at all, and the expand button is the only toggle on screen. A
  // reader in focus mode reaches it by clicking any dead link.
  const NO_SIDEBAR_PAGE = '/this-page-does-not-exist/';

  test('the expand button hides on a page with no sidebar', async ({
    page,
  }) => {
    await gotoPage(page);
    await collapse(page);

    await gotoPage(page, NO_SIDEBAR_PAGE);
    // Guards the premise: if Starlight ever gives this route a sidebar, the
    // assertions below stop testing the sidebar-less case and say so.
    await expect(page.locator('html[data-has-sidebar]')).toHaveCount(0);

    // Present in the DOM (the header mounts it unconditionally) but hidden —
    // its aria-controls points at an id this page does not have.
    await expect(page.locator('[data-sidebar-toggle="expand"]')).toBeHidden();
    await expect(page.locator('[data-sidebar-toggle="collapse"]')).toHaveCount(
      0,
    );
  });

  // CSS can hide the button; it cannot reach the shortcut. Without the guard in
  // sidebar-collapse.ts, Mod+B here rewrites the site-wide preference with
  // nothing on screen moving, and the reader meets the opposite state on the
  // next real page with no way to connect the two.
  test('the shortcut does nothing on a page with no sidebar', async ({
    page,
  }) => {
    await gotoPage(page);
    await collapse(page);

    await gotoPage(page, NO_SIDEBAR_PAGE);
    await page.keyboard.press('ControlOrMeta+b');

    await gotoPage(page);
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
    await gotoPage(page);
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

test.describe('reduced motion', () => {
  // test.use({ reducedMotion: 'reduce' }) is the documented way to set this,
  // but it verifiably does not flip `matchMedia('(prefers-reduced-motion:
  // reduce)')` to true on this Playwright/Chromium combination (checked
  // directly: it stayed false). page.emulateMedia does, so it is used here
  // instead — the context option would make this test pass unconditionally
  // regardless of the CSS, which is worse than not having it.
  //
  // sidebar.css disables the collapse transition under prefers-reduced-motion,
  // but the override only wins because its selectors are declared after the
  // animating-gated rules at matching specificity — at equal specificity a
  // rule earlier in the file can never beat one later, but a rule that moves
  // ahead of its counterpart (or drops the `[data-sidebar-animating]` prefix
  // and so becomes less specific) loses silently, with no type error and no
  // visible symptom outside a real browser. This test is the only thing that
  // would catch that reorder.
  test('the collapse transition is disabled', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoPage(page);
    await collapse(page);

    const durations = await page.evaluate(() => {
      const selectors = [
        '.sidebar-pane',
        '.main-frame',
        '.main-pane',
        '.right-sidebar-container',
      ];
      return selectors.map((selector) => {
        const el = document.querySelector(selector);
        return el && getComputedStyle(el).transitionDuration;
      });
    });

    for (const duration of durations) {
      expect(duration).toBe('0s');
    }
  });
});
