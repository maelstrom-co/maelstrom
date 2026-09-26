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
    '<main><button data-copy-prompt>Copy</button><button data-download-prompt>Download</button><p data-prompt-status role="status"></p></main>',
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
      <details><summary>First prompt</summary><main data-prompt-root>
        <button data-copy-prompt aria-label="Copy first prompt">Copy</button>
        <pre><code>${body.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</code></pre>
        <p data-prompt-status role="status"></p>
      </main></details>
      <details><summary>Second prompt</summary><main data-prompt-root>
        <button data-copy-prompt aria-label="Copy second prompt">Copy</button>
        <pre><code>second &amp; source\n</code></pre>
        <p data-prompt-status role="status"></p>
      </main></details>
    `);
    const roots =
      dom.window.document.querySelectorAll<HTMLElement>('[data-prompt-root]');
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
    roots[1]?.querySelector<HTMLButtonElement>('[data-copy-prompt]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
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
