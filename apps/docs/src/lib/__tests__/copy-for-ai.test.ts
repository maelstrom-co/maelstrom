import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { marked } from 'marked';

import { domToMarkdown, initCopyForAi } from '../copy-for-ai';

describe('domToMarkdown', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function buildContent(html: string): HTMLDivElement {
    const div = document.createElement('div');
    div.classList.add('sl-markdown-content');
    div.innerHTML = html;
    document.body.appendChild(div);
    return div;
  }

  function readExport(el: HTMLElement): HTMLDivElement {
    const parsed = document.createElement('div');
    parsed.innerHTML = marked.parse(domToMarkdown(el), {
      async: false,
      gfm: true,
    });
    return parsed;
  }

  it('converts headings to markdown with correct levels', () => {
    const el = buildContent('<h2>Section</h2><h3>Subsection</h3>');
    const md = domToMarkdown(el);
    expect(md).toContain('## Section');
    expect(md).toContain('### Subsection');
  });

  it('converts paragraphs to plain text', () => {
    const el = buildContent('<p>Hello world</p>');
    const md = domToMarkdown(el);
    expect(md).toContain('Hello world');
  });

  it('converts list items with dashes', () => {
    const el = buildContent('<ul><li>First</li><li>Second</li></ul>');
    const md = domToMarkdown(el);
    expect(md).toMatch(/-\s+First/);
    expect(md).toMatch(/-\s+Second/);
  });

  it('converts code blocks with language', () => {
    const el = buildContent(
      '<pre><code class="language-ts">const x = 1;</code></pre>',
    );
    const md = domToMarkdown(el);
    expect(md).toContain('```ts');
    expect(md).toContain('const x = 1;');
    expect(md).toContain('```');
  });

  it('converts code blocks without language', () => {
    const el = buildContent('<pre><code>plain code</code></pre>');
    const md = domToMarkdown(el);
    expect(md).toContain('```');
    expect(md).toContain('plain code');
  });

  it('converts blockquotes', () => {
    const el = buildContent('<blockquote>Important note</blockquote>');
    const md = domToMarkdown(el);
    expect(md).toContain('> Important note');
  });

  it('handles mixed content', () => {
    const el = buildContent(`
      <h2>Title</h2>
      <p>Some text</p>
      <ul><li>Item one</li></ul>
      <pre><code class="language-js">alert(1)</code></pre>
    `);
    const md = domToMarkdown(el);
    expect(md).toContain('## Title');
    expect(md).toContain('Some text');
    expect(md).toMatch(/-\s+Item one/);
    expect(md).toContain('```js');
    expect(md).toContain('alert(1)');
  });

  it('collapses excessive blank lines', () => {
    const el = buildContent('<p>A</p><p></p><p></p><p>B</p>');
    const md = domToMarkdown(el);
    expect(md).not.toMatch(/\n{3,}/);
  });

  it('returns empty string for empty content', () => {
    const el = buildContent('');
    const md = domToMarkdown(el);
    expect(md.trim()).toBe('');
  });

  it('keeps guide destinations and inline API notation usable outside the page', () => {
    const el = buildContent(
      '<p>Read the <a href="/guides/react/creating-vessels/">Vessel guide</a> before calling <code>createMaelstrom()</code>.</p>',
    );
    const md = domToMarkdown(el);

    expect(md).toContain(
      '[Vessel guide](http://localhost/guides/react/creating-vessels/)',
    );
    expect(md).toContain('`createMaelstrom()`');
    expect(el.querySelector('a')?.getAttribute('href')).toBe(
      '/guides/react/creating-vessels/',
    );
  });

  it('preserves which API constraint belongs to each table field', () => {
    const el = buildContent(`
      <table>
        <thead><tr><th>Field</th><th>Constraint</th></tr></thead>
        <tbody>
          <tr><td><code>minSize</code></td><td>Grid only</td></tr>
          <tr><td><a href="/understanding/grid-vs-tiling/">layoutMode</a></td><td>Tiling or grid</td></tr>
        </tbody>
      </table>
    `);
    const md = domToMarkdown(el);

    expect(md).toMatch(/\|\s*Field\s*\|\s*Constraint\s*\|/);
    expect(md).toMatch(/\|\s*`minSize`\s*\|\s*Grid only\s*\|/);
    expect(md).toContain(
      '[layoutMode](http://localhost/understanding/grid-vs-tiling/)',
    );
    expect(md).toContain('Tiling or grid');
  });

  it('preserves rendered code line breaks and the Expressive Code language', () => {
    const el = buildContent(
      '<pre data-language="ts"><code><div class="ec-line"><div class="code"><span>const value = 1;</span></div></div><div class="ec-line"><div class="code"><span>console.log(value);</span></div></div></code></pre>',
    );

    expect(domToMarkdown(el)).toContain(
      '```ts\nconst value = 1;\nconsole.log(value);\n```',
    );
  });

  it('keeps union types inside one table cell', () => {
    const el = buildContent(
      '<table><thead><tr><th>Field</th><th>Type</th></tr></thead><tbody><tr><td>value</td><td><code>string | number</code></td></tr></tbody></table>',
    );

    const parsed = readExport(el);
    expect(parsed.querySelectorAll('tbody td')).toHaveLength(2);
    expect(parsed.querySelector('tbody code')?.textContent).toBe(
      'string | number',
    );
    expect(domToMarkdown(el)).toMatch(/^\| Field \| Type \|/);
  });

  for (const asCode of [false, true]) {
    it.each([0, 1, 2, 3, 4])(
      `preserves %i backslashes before a pipe in ${asCode ? 'code' : 'text'} without creating another column`,
      (count) => {
        const source = `left${'\\'.repeat(count)}|right`;
        const el = buildContent(
          '<table><thead><tr><th>Value</th><th>Other</th></tr></thead><tbody><tr><td></td><td>end</td></tr></tbody></table>',
        );
        const value = document.createElement(asCode ? 'code' : 'span');
        value.textContent = source;
        el.querySelector('tbody td')?.appendChild(value);

        const parsed = readExport(el);
        const cells = parsed.querySelectorAll('tbody td');
        expect(cells).toHaveLength(2);
        expect(cells[0]?.textContent).toBe(source);
        expect(cells[1]?.textContent).toBe('end');
        if (asCode)
          expect(cells[0]?.querySelector('code')?.textContent).toBe(source);
      },
    );
  }

  it('preserves code punctuation and literal entities without interpreting them as markup', () => {
    const source = '`*_[x] &copy; <script>demo()</script> \\| ©😀';
    const el = buildContent(
      '<table><thead><tr><th>Value</th><th>Other</th></tr></thead><tbody><tr><td><code></code></td><td>end</td></tr></tbody></table>',
    );
    (el.querySelector('code') as HTMLElement).textContent = source;

    const parsed = readExport(el);
    expect(parsed.querySelectorAll('tbody td')).toHaveLength(2);
    expect(parsed.querySelector('code')?.textContent).toBe(source);
    expect(parsed.querySelector('script')).toBeNull();
  });

  it('preserves literal entity text in a table description', () => {
    const source = 'Keep &copy; and &amp; next to \\| literally.';
    const el = buildContent(
      '<table><thead><tr><th>Value</th><th>Other</th></tr></thead><tbody><tr><td></td><td>end</td></tr></tbody></table>',
    );
    (el.querySelector('tbody td') as HTMLElement).textContent = source;

    const parsed = readExport(el);
    expect(parsed.querySelectorAll('tbody td')).toHaveLength(2);
    expect(parsed.querySelector('tbody td')?.textContent).toBe(source);
  });

  it('preserves link and image metadata containing backslash-pipe sequences', () => {
    const title = 'Guide \\| [details] &copy;';
    const alt = 'Diagram \\| [states] &copy;';
    const el = buildContent(
      '<table><thead><tr><th>Guide</th><th>Diagram</th></tr></thead><tbody><tr><td><a href="/guide/?mode=a|b">Read</a></td><td><img src="/diagram.svg"></td></tr></tbody></table>',
    );
    el.querySelector('a')?.setAttribute('title', title);
    el.querySelector('img')?.setAttribute('title', title);
    el.querySelector('img')?.setAttribute('alt', alt);

    const parsed = readExport(el);
    expect(parsed.querySelectorAll('tbody td')).toHaveLength(2);
    expect(parsed.querySelector('a')?.getAttribute('href')).toBe(
      'http://localhost/guide/?mode=a|b',
    );
    expect(parsed.querySelector('a')?.getAttribute('title')).toBe(title);
    expect(parsed.querySelector('img')?.getAttribute('title')).toBe(title);
    expect(parsed.querySelector('img')?.getAttribute('alt')).toBe(alt);
  });

  it('keeps ordinary code as Markdown when no table separator is present', () => {
    const el = buildContent('<p>Call <code>createMaelstrom()</code>.</p>');
    expect(domToMarkdown(el)).toContain('`createMaelstrom()`');
  });

  it('preserves Expressive Code blank-line placeholders without adding source lines', () => {
    const el = buildContent(
      '<pre data-language="ts"><code><div class="ec-line"><div class="code">import { vessel } from "sdk";</div></div><div class="ec-line"><div class="code">\n</div></div><div class="ec-line"><div class="code">  const value = 1;</div></div></code></pre>',
    );

    expect(domToMarkdown(el)).toContain(
      'import { vessel } from "sdk";\n\n  const value = 1;',
    );
  });

  it('labels both tab panels without copying navigation links that cannot work in Markdown', () => {
    const el = buildContent(
      '<starlight-tabs><ul role="tablist"><li><a role="tab" id="react-tab" href="#react-panel">React</a></li><li><a role="tab" id="js-tab" href="#js-panel">Vanilla JS</a></li></ul><div role="tabpanel" id="react-panel" aria-labelledby="react-tab"><pre><code class="language-tsx">const react = true;</code></pre></div><div role="tabpanel" id="js-panel" aria-labelledby="js-tab" hidden><pre><code class="language-js">const vanilla = true;</code></pre></div></starlight-tabs>',
    );
    const markdown = domToMarkdown(el);

    expect(markdown).not.toContain('#react-panel');
    expect(markdown).not.toContain('#js-panel');
    expect(markdown).toContain('**React**');
    expect(markdown).toContain('**Vanilla JS**');
    expect(markdown.indexOf('**React**')).toBeLessThan(
      markdown.indexOf('const react'),
    );
    expect(markdown.indexOf('**Vanilla JS**')).toBeLessThan(
      markdown.indexOf('const vanilla'),
    );
    expect(el.querySelector('[role="tablist"]')).not.toBeNull();
  });

  it('keeps multiline constraints in their original table cell', () => {
    const el = buildContent(
      '<table><thead><tr><th>Field</th><th>Constraint</th></tr></thead><tbody><tr><td>value</td><td>Required<br>Nonempty</td></tr></tbody></table>',
    );

    expect(domToMarkdown(el)).toMatch(
      /\|\s*value\s*\|\s*Required\s*<br>Nonempty\s*\|/,
    );
  });

  it('keeps nested examples inside one intact code fence', () => {
    const el = buildContent(
      '<pre><code class="language-md"># Example\n\n```ts\nconst value = 1;\n```\n</code></pre>',
    );

    expect(domToMarkdown(el)).toContain(
      '````md\n# Example\n\n```ts\nconst value = 1;\n```\n````',
    );
  });

  it('copies nested lists and quotes once, preserving their structure', () => {
    const el = buildContent(
      '<ol start="3"><li>Install packages<ul><li><p>Register Vessels</p></li></ul></li></ol><blockquote><p>Keep provider keys server-side.</p></blockquote>',
    );
    const md = domToMarkdown(el);

    expect(md).toMatch(/3\.\s+Install packages/);
    expect(md).toMatch(/\n\s+-\s+Register Vessels/);
    expect(md.match(/Register Vessels/g)).toHaveLength(1);
    expect(md.match(/Keep provider keys server-side\./g)).toHaveLength(1);
    expect(md).toContain('> Keep provider keys server-side.');
  });

  it('omits page controls and closed prompt dialogs from documentation', () => {
    const el = buildContent(
      '<div class="heading-wrapper"><h2>Setup</h2><a class="sl-anchor-link" href="#setup">Section titled Setup</a></div><p>Install the SDK.</p><button>Copy code</button><dialog><pre><code>Hidden onboarding prompt</code></pre></dialog>',
    );
    const md = domToMarkdown(el);

    expect(md).toContain('## Setup');
    expect(md).toContain('Install the SDK.');
    expect(md).not.toContain('Section titled');
    expect(md).not.toContain('Copy code');
    expect(md).not.toContain('Hidden onboarding prompt');
  });
});

describe('initCopyForAi', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(
    navigator,
    'clipboard',
  );

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('does not throw when no .copy-for-ai-btn exists', () => {
    expect(() => initCopyForAi()).not.toThrow();
  });

  it('writes one complete document when initialization runs again after navigation', async () => {
    const writeText = mock(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    document.body.innerHTML =
      '<h1>Actions</h1><div class="sl-markdown-content"><p>Read <a href="/guides/react/variants-and-actions/">the Action guide</a>.</p></div><button class="copy-for-ai-btn">Copy for AI</button>';

    initCopyForAi();
    initCopyForAi();
    (document.querySelector('.copy-for-ai-btn') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledTimes(1);
    const markdown = writeText.mock.calls[0][0];
    expect(markdown).toContain('# Actions\nSource: http://localhost/');
    expect(markdown).toContain(
      '[the Action guide](http://localhost/guides/react/variants-and-actions/)',
    );
  });
});
