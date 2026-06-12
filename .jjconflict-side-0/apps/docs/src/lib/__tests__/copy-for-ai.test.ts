import { describe, it, expect, beforeEach } from 'bun:test';
import { domToMarkdown, initCopyForAi } from '../copy-for-ai';

describe('domToMarkdown', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function buildContent(html: string): Element {
    const div = document.createElement('div');
    div.classList.add('sl-markdown-content');
    div.innerHTML = html;
    document.body.appendChild(div);
    return div;
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
    expect(md).toContain('- First');
    expect(md).toContain('- Second');
  });

  it('converts code blocks with language', () => {
    const el = buildContent('<pre><code class="language-ts">const x = 1;</code></pre>');
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
    expect(md).toContain('- Item one');
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
});

describe('initCopyForAi', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('does not throw when no .copy-for-ai-btn exists', () => {
    expect(() => initCopyForAi()).not.toThrow();
  });
});
