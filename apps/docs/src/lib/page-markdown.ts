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
converter.addRule('starlightAside', {
  filter: (node) =>
    node.nodeName === 'ASIDE' && node.classList.contains('starlight-aside'),
  replacement(content, node) {
    const kind = Array.from((node as HTMLElement).classList)
      .find((name) => name.startsWith('starlight-aside--'))
      ?.slice('starlight-aside--'.length);
    const alert =
      (
        {
          danger: 'CAUTION',
          caution: 'WARNING',
          tip: 'TIP',
          note: 'NOTE',
        } as Record<string, string>
      )[kind ?? ''] ?? 'NOTE';
    return `\n\n> [!${alert}]\n${content
      .trim()
      .split('\n')
      .map((line) => '> ' + line)
      .join('\n')}\n\n`;
  },
});
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

/** Convert rendered documentation to Markdown without changing the page. */
export function domToMarkdown(
  root: HTMLElement,
  baseUrl = root.baseURI,
): string {
  // Inert documents prevent custom-element constructors from running on clones.
  const inert = root.ownerDocument.implementation.createHTMLDocument();
  const content = inert.importNode(root, true);
  for (const pre of content.querySelectorAll('pre.mermaid')) {
    const code = inert.createElement('code');
    code.className = 'language-mermaid';
    code.textContent = (
      pre.getAttribute('data-diagram') ??
      pre.textContent ??
      ''
    ).trim();
    pre.replaceChildren(code);
  }
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
      'button, dialog, script, style, svg, .sl-anchor-link, [role="tablist"], [role="tab"], [data-markdown-exclude]',
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
      element.setAttribute(attribute, new URL(value, baseUrl).href);
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

/** Format a rendered page for direct retrieval and clipboard use. */
export function documentToMarkdown(
  page: Document,
  sourceUrl = page.URL,
): string | null {
  const content = page.querySelector<HTMLElement>('.sl-markdown-content');
  const title = page.querySelector('h1')?.textContent?.trim();
  if (!content || !title) return null;
  const cleanUrl = new URL(sourceUrl);
  cleanUrl.hash = '';
  cleanUrl.search = '';
  const revision = page.querySelector<HTMLMetaElement>(
    'meta[name="maelstrom-docs-revision"]',
  )?.content;
  const versions = page.querySelector<HTMLMetaElement>(
    'meta[name="maelstrom-sdk-versions"]',
  )?.content;
  const context = [
    revision ? 'Documentation revision: ' + revision : '',
    versions ? 'SDK manifests in this build: ' + versions : '',
    revision
      ? 'These docs follow this source revision. Manifest versions do not prove release compatibility; verify the installed package exports before using an API.'
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    '# ' +
    title +
    '\nSource: ' +
    cleanUrl.href +
    (context ? '\n' + context : '') +
    '\n\n' +
    domToMarkdown(content, cleanUrl.href) +
    '\n'
  );
}
