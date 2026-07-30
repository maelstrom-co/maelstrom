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

  // This page is the only hand-authored HTML prose in the docs; everything else
  // is Markdown. `compressHTML` is pinned to `true` in astro.config.ts rather
  // than Astro 7's `'jsx'` default, which keeps a source newline rendering as a
  // space and so removes the sharp edge here — under `'jsx'` a line that merely
  // *began* with an inline tag shipped `theResizeObserver`. What this still
  // catches is the plain authoring mistake: no whitespace in the source at all.
  // The build accepts that, the markup is valid, and only a reader notices.
  //
  // Asserted structurally rather than against a list of expected phrases. A
  // phrase list has to be extended by hand for every new paragraph — so it
  // silently fails to cover exactly the prose most likely to be edited — and it
  // turns any routine copy edit into a confusing e2e failure about spacing.
  // Walking the DOM instead enforces the rule for all present and future
  // paragraphs with no copy duplicated into the test.
  test('inline elements in prose keep the spaces around them', async ({
    page,
  }) => {
    await page.goto(PAGE);

    const glued = await page
      .locator('.sl-markdown-content')
      .evaluate((root) => {
        const INLINE_SELECTOR = 'code, a, em, strong, b, i';
        const isWord = (c: string | undefined) =>
          !!c && /[\p{L}\p{N}]/u.test(c);
        const isInline = (el: Element) =>
          /^inline/.test(getComputedStyle(el).display);

        // Only the immediately adjacent node counts. Reading the parent's
        // flattened textContent would splice in block siblings — a <dt> ending a
        // word right before a <dd> starting one is not an inline adjacency.
        const edgeChar = (node: ChildNode | null, side: 'end' | 'start') => {
          if (!node) return undefined;
          if (node.nodeType === Node.TEXT_NODE) {
            const t = node.textContent ?? '';
            return side === 'end' ? t[t.length - 1] : t[0];
          }
          if (node.nodeType !== Node.ELEMENT_NODE) return undefined;
          const el = node as Element;
          if (!isInline(el)) return undefined;
          const t = el.textContent ?? '';
          return side === 'end' ? t[t.length - 1] : t[0];
        };

        const hits: string[] = [];
        for (const el of Array.from(root.querySelectorAll(INLINE_SELECTOR))) {
          if (el.parentElement?.closest(INLINE_SELECTOR)) continue;
          if (!isInline(el)) continue;
          const text = el.textContent ?? '';
          if (!text.trim()) continue;

          const before = edgeChar(el.previousSibling, 'end');
          const after = edgeChar(el.nextSibling, 'start');
          if (
            (isWord(before) && isWord(text[0])) ||
            (isWord(after) && isWord(text[text.length - 1]))
          ) {
            hits.push(`${before ?? '∅'}[${text.slice(0, 32)}]${after ?? '∅'}`);
          }
        }
        return hits;
      });

    expect(
      glued,
      'an inline element renders with no whitespace separating it from adjacent ' +
        "prose — add a space in the source, or write {' '}",
    ).toEqual([]);
  });
});
