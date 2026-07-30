import { describe, expect, it } from 'bun:test';
import { code } from './code.ts';
import { backtickCount } from './test-helpers/backtick-count.ts';

describe('code', () => {
  it.each([
    ['a pipe', 'Ada | Lovelace'],
    ['a backtick', 'Ada `Lovelace`'],
    ['Markdown emphasis', 'Ada **Lovelace** _the_ [first](https://x)'],
    ['an HTML tag', 'Ada <img src="https://attacker.example/x.png">'],
  ])('renders %s as a single inert code span', (_label, value) => {
    const span = code(value);
    // Exactly one code span: the two delimiters and nothing that could close
    // it early and let the rest of the cell render as Markdown.
    expect(backtickCount(span)).toBe(2);
    expect(span.startsWith('`')).toBe(true);
    expect(span.endsWith('`')).toBe(true);
    // No unescaped pipe survives to break out of the cell it lands in.
    expect(span.split(/(?<!\\)\|/)).toHaveLength(1);
  });
});
