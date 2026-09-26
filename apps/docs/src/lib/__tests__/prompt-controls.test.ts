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
    initPromptControls(root, {
      body,
      filename: 'sample-v1.0.0.md',
      clipboard: {
        writeText: async (value) => {
          copied = value;
        },
      },
    });
    root.querySelector('button')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(copied).toBe(body);
    expect(root.querySelector('[role="status"]')?.textContent).toBe(
      'Prompt copied.',
    );
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
