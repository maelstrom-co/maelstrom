import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import {
  copyPromptBody,
  downloadPromptBody,
  initPromptControls,
} from '../prompt-controls';

const body = '```tsx\nconst title = "café 🧭 &amp;";\n```\n';

function page() {
  const dom = new JSDOM(
    '<main><button data-copy-prompt aria-label="Copy sample prompt" title="Copy sample prompt"><svg aria-hidden="true"></svg></button><button data-download-prompt aria-label="Download sample prompt" title="Download sample prompt"><svg aria-hidden="true"></svg></button><p data-prompt-status role="status"></p></main>',
  );
  return {
    dom,
    root: dom.window.document.querySelector('main') as HTMLElement,
  };
}

describe('canonical prompt controls', () => {
  test('copies the exact body and reports success', async () => {
    const { dom, root } = page();
    let copied = '';
    const options = {
      body,
      filename: 'sample-v1.0.0.md',
      clipboard: {
        writeText: async (value: string) => {
          copied = value;
        },
      },
    };
    initPromptControls(root, options);
    initPromptControls(root, options);
    root.querySelector('button')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(copied).toBe(body);
    expect(root.querySelector('[role="status"]')?.textContent).toBe(
      'Prompt copied.',
    );
    dom.window.close();
  });

  test('keeps multiple collapsed prompt panels independent when copying', async () => {
    const dom = new JSDOM(`
      <details data-prompt-root>
        <summary>First prompt <button data-copy-prompt aria-label="Copy first prompt" title="Copy first prompt"><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"></svg></button></summary>
        <pre><code>${body.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</code></pre>
        <p data-prompt-status role="status"></p>
      </details>
      <details data-prompt-root>
        <summary>Second prompt <button data-copy-prompt aria-label="Copy second prompt" title="Copy second prompt"><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"></svg></button></summary>
        <button data-download-prompt aria-label="Download second prompt" title="Download second prompt"><svg aria-hidden="true"></svg></button>
        <pre><code>second &amp; source\n</code></pre>
        <p data-prompt-status role="status"></p>
      </details>
    `);
    const roots =
      dom.window.document.querySelectorAll<HTMLElement>('[data-prompt-root]');
    let bubbled = false;
    roots[1]?.addEventListener('click', () => {
      bubbled = true;
    });
    const copied: string[] = [];
    const clipboard = {
      writeText: async (value: string) => {
        copied.push(value);
      },
    };
    const secondBody = 'second & source\\n';
    initPromptControls(roots[0]!, { body, filename: 'first.md', clipboard });
    initPromptControls(roots[1]!, {
      body: secondBody,
      filename: 'second.md',
      clipboard,
    });

    expect(dom.window.document.querySelector('details')?.open).toBe(false);
    expect(roots[0]?.querySelector('pre')?.textContent).toBe(body);
    expect(roots[1]?.querySelector('[data-copy-prompt]')?.textContent).toBe('');
    expect(
      roots[1]?.querySelector('[data-copy-prompt]')?.getAttribute('aria-label'),
    ).toBe('Copy second prompt');
    expect(
      roots[1]
        ?.querySelector('[data-copy-prompt] svg')
        ?.getAttribute('aria-hidden'),
    ).toBe('true');
    const downloadButton = roots[1]?.querySelector<HTMLButtonElement>(
      '[data-download-prompt]',
    );
    expect(downloadButton?.textContent).toBe('');
    expect(downloadButton?.getAttribute('aria-label')).toBe(
      'Download second prompt',
    );
    const click = new dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    });
    roots[1]
      ?.querySelector<HTMLButtonElement>('[data-copy-prompt]')
      ?.dispatchEvent(click);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(click.defaultPrevented).toBe(true);
    expect(bubbled).toBe(false);
    expect(copied).toEqual([secondBody]);
    expect(roots[1]?.querySelector('[role="status"]')?.textContent).toBe(
      'Prompt copied.',
    );
    expect(roots[0]?.querySelector('[role="status"]')?.textContent).toBe('');
    dom.window.close();
  });

  test('reports clipboard unavailability and rejection truthfully', async () => {
    await expect(copyPromptBody(body, undefined)).rejects.toThrow(
      'Clipboard is unavailable',
    );
    const { dom, root } = page();
    initPromptControls(root, {
      body,
      filename: 'sample-v1.0.0.md',
      clipboard: {
        writeText: async () => {
          throw new Error('denied');
        },
      },
    });
    root.querySelector('button')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelector('[role="status"]')?.textContent).toContain(
      'Could not copy',
    );
    dom.window.close();
  });

  test('downloads exact Markdown bytes with the versioned filename', () => {
    const { dom } = page();
    let blob: Blob | undefined;
    let download = '';
    let clicked = false;
    const document = dom.window.document;
    const originalCreate = document.createElement.bind(document);
    const create = (tag: string) => {
      const element = originalCreate(tag);
      if (tag === 'a') {
        Object.defineProperty(element, 'click', {
          value: () => {
            clicked = true;
          },
        });
        Object.defineProperty(element, 'download', {
          set: (value: string) => {
            download = value;
          },
        });
      }
      return element;
    };
    Object.defineProperty(document, 'createElement', { value: create });
    downloadPromptBody(body, 'sample-v1.0.0.md', {
      document,
      createObjectURL: (value) => {
        blob = value;
        return 'blob:test';
      },
      revokeObjectURL: () => {},
    });
    expect(download).toBe('sample-v1.0.0.md');
    expect(clicked).toBe(true);
    expect(blob).toBeDefined();
    return blob!.text().then((text) => {
      expect(text).toBe(body);
      dom.window.close();
    });
  });
});
