import { describe, it, expect, beforeEach } from 'bun:test';
import { enhanceCodeBlocks } from '../code-blocks';

describe('enhanceCodeBlocks', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function createCodeBlock(options?: { title?: string; code?: string }) {
    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');
    codeEl.textContent = options?.code ?? 'console.log("hello")';
    pre.appendChild(codeEl);
    pre.classList.add('astro-code');
    if (options?.title) {
      pre.setAttribute('data-title', options.title);
    }
    document.body.appendChild(pre);
    return pre;
  }

  it('wraps .astro-code blocks in a .code-block container', () => {
    createCodeBlock();
    enhanceCodeBlocks();

    const wrapper = document.querySelector('.code-block');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.querySelector('.astro-code')).not.toBeNull();
  });

  it('adds a copy button with correct aria-label', () => {
    createCodeBlock();
    enhanceCodeBlocks();

    const btn = document.querySelector('.code-copy-btn');
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute('aria-label')).toBe('Copy to clipboard');
    expect(btn!.getAttribute('type')).toBe('button');
  });

  it('adds a title bar when data-title is present', () => {
    createCodeBlock({ title: 'app.tsx' });
    enhanceCodeBlocks();

    const header = document.querySelector('.code-block-header');
    expect(header).not.toBeNull();
    const title = document.querySelector('.code-block-title');
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe('app.tsx');
  });

  it('does not add a title bar when data-title is absent', () => {
    createCodeBlock();
    enhanceCodeBlocks();

    const header = document.querySelector('.code-block-header');
    expect(header).toBeNull();
  });

  it('is idempotent — does not double-wrap on second call', () => {
    createCodeBlock();
    enhanceCodeBlocks();
    enhanceCodeBlocks();

    const wrappers = document.querySelectorAll('.code-block');
    expect(wrappers.length).toBe(1);
  });

  it('enhances multiple code blocks independently', () => {
    createCodeBlock({ title: 'first.ts' });
    createCodeBlock({ title: 'second.ts' });
    enhanceCodeBlocks();

    const wrappers = document.querySelectorAll('.code-block');
    expect(wrappers.length).toBe(2);
    const titles = document.querySelectorAll('.code-block-title');
    expect(titles[0].textContent).toBe('first.ts');
    expect(titles[1].textContent).toBe('second.ts');
  });

  it('accepts a custom root element', () => {
    const container = document.createElement('div');
    const pre = document.createElement('pre');
    pre.classList.add('astro-code');
    container.appendChild(pre);
    document.body.appendChild(container);

    // Also add one outside the container
    createCodeBlock();

    enhanceCodeBlocks(container);

    // Only the one inside the container should be wrapped
    const wrappers = container.querySelectorAll('.code-block');
    expect(wrappers.length).toBe(1);

    // The one outside should remain unwrapped
    const outsideBlock = document.body.querySelector(':scope > .astro-code');
    expect(outsideBlock).not.toBeNull();
  });
});
