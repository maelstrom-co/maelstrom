import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { highlightTypeScript } from './highlight-typescript';

const EXAMPLES_DIRECTORY = join(
  import.meta.dirname,
  '../examples/how-it-works',
);

const EXAMPLE_FILES = [
  'orders.vessel.ts',
  'maelstrom.ts',
  'Dashboard.tsx',
  'engine-response.json',
  'OrdersVessel.tsx',
];

// The token classes styled in src/styles/global.css.
const STYLED_TOKEN_TAG =
  /^(?:<span class="tk-(?:key|fn|str|num|com|ty|pn|var|att)">|<\/span>)$/;

// Stripping only token spans leaves any other markup in the visible text, so
// the round-trip checks fail on it.
const TOKEN_SPAN_TAGS = /<span class="tk-[a-z]+">|<\/span>/g;

describe('highlightTypeScript', () => {
  for (const file of EXAMPLE_FILES) {
    const source = readFileSync(join(EXAMPLES_DIRECTORY, file), 'utf8');

    it(`renders ${file} back to its exact source text`, () => {
      expect(visibleText(highlightTypeScript(source))).toBe(source);
    });

    it(`marks up ${file} with styled token spans only`, () => {
      const tags = highlightTypeScript(source).match(/<[^>]*>/g) ?? [];
      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) {
        expect(tag).toMatch(STYLED_TOKEN_TAG);
      }
    });
  }

  it('keeps whitespace, line endings and non-ASCII text exactly', () => {
    const source =
      '\tconst  first = 1;  \r\n\r\n// zażółć 🌊\n  let second = "x"\t;\n\n';
    expect(visibleText(highlightTypeScript(source))).toBe(source);
  });

  it('escapes markup characters so source text cannot inject HTML', () => {
    const source =
      "if (a < b && c > d) render('</code><script>alert(1)</script>');";
    const html = highlightTypeScript(source);
    const text = html.replace(TOKEN_SPAN_TAGS, '');

    expect(html).toContain('&lt;');
    expect(html).toContain('&gt;');
    expect(html).toContain('&amp;&amp;');
    expect(html).not.toContain('<script>');
    expect(text).not.toMatch(/[<>]/);
    expect(text).not.toMatch(/&(?!(?:lt|gt|amp|quot|apos|#39|#x27);)/);
    expect(visibleText(html)).toBe(source);
  });

  it('classes keywords, strings, comments and calls', () => {
    const html = highlightTypeScript(
      [
        '// Open order 1847',
        "const intent = 'Open order 1847';",
        'void processIntent(intent);',
      ].join('\n'),
    );

    expect(classesOf(html, 'const')).toEqual(['tk-key']);
    expect(classesOf(html, 'void')).toEqual(['tk-key']);
    expect(classesOf(html, "'Open order 1847'")).toEqual(['tk-str']);
    expect(classesOf(html, '// Open order 1847')).toEqual(['tk-com']);
    expect(classesOf(html, 'processIntent')).toEqual(['tk-fn']);
    expect(classesOf(html, 'intent')).toEqual(['tk-var', 'tk-var']);
  });

  it('classes numbers, object keys, type names and other identifiers', () => {
    const html = highlightTypeScript(
      [
        "const size = { width: 4, 'height': 3 };",
        'const choice = ready ? first : second;',
        'function render({ instanceId }: TypedVesselProps<typeof ordersVessel>) {',
        '  return <OrdersPanel />;',
        '}',
      ].join('\n'),
    );

    expect(classesOf(html, '4')).toEqual(['tk-num']);
    expect(classesOf(html, '3')).toEqual(['tk-num']);
    expect(classesOf(html, 'width')).toEqual(['tk-att']);
    expect(classesOf(html, "'height'")).toEqual(['tk-att']);
    expect(classesOf(html, 'render')).toEqual(['tk-fn']);
    expect(classesOf(html, 'TypedVesselProps')).toEqual(['tk-ty']);
    expect(classesOf(html, 'OrdersPanel')).toEqual(['tk-ty']);
    for (const name of [
      'size',
      'choice',
      'ready',
      'first',
      'second',
      'instanceId',
      'ordersVessel',
    ]) {
      expect(classesOf(html, name)).toEqual(['tk-var']);
    }
  });

  it('classes template text as strings and substitutions as code', () => {
    const source = `const label = \`Order \${orderId} of \${total}\`;`;
    const html = highlightTypeScript(source);
    const templateText = tokensOf(html).filter(
      (token) => token.text.includes('Order') || token.text.includes(' of '),
    );

    expect(templateText.length).toBeGreaterThan(0);
    for (const token of templateText) {
      expect(token.className).toBe('tk-str');
    }
    expect(classesOf(html, 'orderId')).toEqual(['tk-var']);
    expect(classesOf(html, 'total')).toEqual(['tk-var']);
    expect(visibleText(html)).toBe(source);
  });

  it('classes JSON keys as attributes and JSON values by kind', () => {
    const html = highlightTypeScript(
      [
        '{',
        '  "type": "tiling",',
        '  "weight": 2,',
        '  "tree": ["ID:orders-1"]',
        '}',
      ].join('\n'),
    );

    expect(classesOf(html, '"type"')).toEqual(['tk-att']);
    expect(classesOf(html, '"weight"')).toEqual(['tk-att']);
    expect(classesOf(html, '"tiling"')).toEqual(['tk-str']);
    expect(classesOf(html, '2')).toEqual(['tk-num']);
    expect(classesOf(html, '"ID:orders-1"')).toEqual(['tk-str']);
  });
});

// Reverses the highlighter: drop the token spans, then decode the entities it may emit.
function visibleText(html: string): string {
  return unescapeEntities(html.replace(TOKEN_SPAN_TAGS, ''));
}

function tokensOf(html: string): { className: string; text: string }[] {
  return [...html.matchAll(/<span class="(tk-[a-z]+)">([^<]*)<\/span>/g)].map(
    ([, className = '', text = '']) => ({
      className,
      text: unescapeEntities(text),
    }),
  );
}

function classesOf(html: string, text: string): string[] {
  return tokensOf(html)
    .filter((token) => token.text === text)
    .map((token) => token.className);
}

function unescapeEntities(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&#x27;', "'")
    .replaceAll('&amp;', '&');
}
