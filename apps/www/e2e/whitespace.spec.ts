import { expect, test } from '@playwright/test';

/**
 * www is entirely hand-authored .astro and had no rendered-output coverage at
 * all, which is the gap this closes. `compressHTML` is pinned to `true` in
 * astro.config.ts rather than Astro 7's `'jsx'` default, so a source newline
 * still renders as a space — under `'jsx'` the hero shipped as
 * `Maelstromorchestratesyour UI.` purely from where its lines broke. What
 * remains catchable is the plain authoring mistake: no whitespace in the source
 * between prose and an inline tag.
 *
 * Runs in a real browser because CSS decides whether a missing space is visible:
 * between flex/grid children the whitespace never rendered to begin with, so a
 * DOM-only check would flag every nav and button row as broken.
 */
const PAGES = ['/', '/404.html'];

async function gluedInlineText(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const INLINE_SELECTOR = 'code, a, em, strong, b, i, span';
    const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
    const isInline = (el: Element) =>
      /^inline/.test(getComputedStyle(el).display);

    /**
     * The boundary character on one side of `el`, or undefined when that side
     * is not in the same inline flow. Reading the parent's flattened
     * textContent instead would splice in block siblings — a section eyebrow
     * followed by an <h2> is not an inline adjacency, and reporting it as one
     * buries the real hits.
     */
    const edgeChar = (node: ChildNode | null, side: 'end' | 'start') => {
      if (!node) return undefined;
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent ?? '';
        return side === 'end' ? t[t.length - 1] : t[0];
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return undefined;
      const el = node as Element;
      if (!isInline(el)) return undefined; // block/flex sibling: layout separates
      const t = el.textContent ?? '';
      return side === 'end' ? t[t.length - 1] : t[0];
    };

    const hits: string[] = [];
    for (const el of Array.from(document.querySelectorAll(INLINE_SELECTOR))) {
      const parent = el.parentElement;
      if (!parent) continue;
      if (parent.closest(INLINE_SELECTOR)) continue; // nested: same boundary twice
      if (!isInline(el)) continue; // flex items are blockified; nothing to lose
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
}

for (const path of PAGES) {
  test(`inline elements keep the spaces around them on ${path}`, async ({
    page,
  }) => {
    await page.goto(path);

    expect(
      await gluedInlineText(page),
      'an inline element renders with no whitespace separating it from adjacent ' +
        "prose — add a space in the source, or write {' '}",
    ).toEqual([]);
  });
}
