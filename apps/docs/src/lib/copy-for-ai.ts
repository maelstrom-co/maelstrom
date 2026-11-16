import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

function encodeLiteralPunctuation(value: string): string {
  return Array.from(value, (character) =>
    /^[\p{L}\p{N} ]$/u.test(character)
      ? character
      : `&#${character.codePointAt(0)};`,
  ).join('');
}

const converter = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});
const escapeMarkdown = converter.escape.bind(converter);
// Literal entity text must survive Markdown's HTML-entity decoding.
converter.escape = (text) => escapeMarkdown(text).replace(/&/g, '&amp;');
converter.use(gfm);
converter.addRule('tableCodeWithPipes', {
  filter(node) {
    return (
      node.nodeName === 'CODE' &&
      node.parentElement?.nodeName !== 'PRE' &&
      node.closest('table') !== null &&
      (node.textContent ?? '').includes('|')
    );
  },
  replacement(_content, node) {
    // Entities stay literal inside Markdown code spans, so use encoded HTML.
    return `<code>${encodeLiteralPunctuation(node.textContent ?? '')}</code>`;
  },
});
converter.addRule('tableCells', {
  filter: ['th', 'td'],
  replacement(content, node) {
    const cell = content.trim().replace(/\|/g, '&#124;').replace(/\n/g, '<br>');
    return `${node.previousElementSibling ? ' ' : '| '}${cell} |`;
  },
});

const initializedButtons = new WeakSet<Element>();

/** Convert rendered documentation to Markdown without changing the page. */
export function domToMarkdown(root: HTMLElement): string {
  const content = root.cloneNode(true) as HTMLElement;
  const tabLabels = new Map(
    Array.from(content.querySelectorAll('[role="tab"]'), (tab) => [
      tab.id,
      tab.textContent?.trim() ?? '',
    ]),
  );
  for (const panel of content.querySelectorAll('[role="tabpanel"]')) {
    const label = (panel.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .map((id) => tabLabels.get(id) ?? '')
      .filter(Boolean)
      .join(' ');
    if (!label) continue;
    const paragraph = content.ownerDocument.createElement('p');
    const emphasis = content.ownerDocument.createElement('strong');
    emphasis.textContent = label;
    paragraph.appendChild(emphasis);
    panel.prepend(paragraph);
  }
  content
    .querySelectorAll(
      'button, dialog, script, style, svg, .sl-anchor-link, [role="tablist"], [role="tab"]',
    )
    .forEach((element) => element.remove());

  for (const element of content.querySelectorAll('a[href], img[src]')) {
    for (const attribute of ['title', 'alt']) {
      const value = element.getAttribute(attribute);
      if (value !== null) {
        element.setAttribute(attribute, encodeLiteralPunctuation(value));
      }
    }
    const attribute = element.tagName === 'A' ? 'href' : 'src';
    const value = element.getAttribute(attribute);
    if (!value) continue;
    try {
      element.setAttribute(attribute, new URL(value, root.baseURI).href);
    } catch {
      // Keep malformed source URLs intact so copying still preserves the text.
    }
  }

  for (const pre of content.querySelectorAll('pre')) {
    const code = pre.querySelector('code');
    if (!code) continue;
    const lines = pre.querySelectorAll('.ec-line .code');
    if (lines.length) {
      // Expressive Code stores line boundaries in elements, not text newlines.
      code.textContent = Array.from(lines, (line) => {
        const text = line.textContent ?? '';
        return text === '\n' ? '' : text;
      }).join('\n');
    }
    const language = pre.getAttribute('data-language')?.trim().split(/\s+/)[0];
    if (language) code.classList.add(`language-${language}`);
  }

  return converter.turndown(content);
}

/** Attach click handlers to all `.copy-for-ai-btn` elements on the page. */
export function initCopyForAi(): void {
  document.querySelectorAll('.copy-for-ai-btn').forEach((btn) => {
    if (initializedButtons.has(btn)) return;
    initializedButtons.add(btn);
    btn.addEventListener('click', async () => {
      const content = document.querySelector<HTMLElement>(
        '.sl-markdown-content',
      );
      if (!content) return;

      const title = document.querySelector('h1')?.textContent?.trim() || '';
      const url = window.location.href;

      try {
        const markdown = `# ${title}\nSource: ${url}\n\n${domToMarkdown(content)}`;
        await navigator.clipboard.writeText(markdown);
        const original = btn.innerHTML;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
        setTimeout(() => {
          btn.innerHTML = original;
        }, 2000);
      } catch {
        const original = btn.innerHTML;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Copy failed`;
        setTimeout(() => {
          btn.innerHTML = original;
        }, 2000);
      }
    });
  });
}
