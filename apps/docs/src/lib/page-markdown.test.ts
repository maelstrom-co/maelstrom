import { afterEach, expect, test } from 'bun:test';

import { domToMarkdown } from './page-markdown';

afterEach(() => {
  document.body.innerHTML = '';
});

test('copying documentation does not run custom-element constructors on incomplete clones', () => {
  let constructions = 0;
  window.customElements.define(
    'markdown-tabs-fixture',
    class extends window.HTMLElement {
      constructor() {
        super();
        constructions++;
      }
    },
  );
  document.body.innerHTML =
    '<div class="sl-markdown-content"><markdown-tabs-fixture><p>Keep this tab content.</p></markdown-tabs-fixture></div>';
  const before = constructions;
  expect(before).toBe(1);
  expect(
    domToMarkdown(document.querySelector<HTMLElement>('.sl-markdown-content')!),
  ).toContain('Keep this tab content.');
  expect(constructions).toBe(before);
});
