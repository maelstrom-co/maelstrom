import { describe, expect, it } from 'bun:test';
import { code } from './code.ts';
import { row } from './row.ts';
import { backtickCount } from './test-helpers/backtick-count.ts';
import { cellsOf } from './test-helpers/cells-of.ts';

describe('code', () => {
  it.each([
    ['a pipe', 'Ada | Lovelace'],
    ['a backtick', 'Ada `Lovelace`'],
    ['Markdown emphasis', 'Ada **Lovelace** _the_ [first](https://x)'],
    ['an HTML tag', 'Ada <img src="https://attacker.example/x.png">'],
    ['a backslash before a pipe', 'Ada \\| Lovelace'],
    ['a lone backslash', 'Ada \\Lovelace'],
    ['a trailing backslash', 'Ada Lovelace\\'],
    ['a doubled backslash', 'Ada \\\\ Lovelace'],
    ['a backslash before a backtick', 'Ada \\`Lovelace`'],
  ])('renders %s as a single inert code span', (_label, value) => {
    const span = code(value);
    // Exactly one code span: the two delimiters and nothing that could close
    // it early and let the rest of the cell render as Markdown.
    expect(backtickCount(span)).toBe(2);
    expect(span.startsWith('`')).toBe(true);
    expect(span.endsWith('`')).toBe(true);
    // The span fills one cell and no more: no pipe inside it survives as a
    // boundary, and it does not swallow the boundary that follows it.
    expect(cellsOf(row([span, 'next']))).toEqual([` ${span} `, ' next ']);
    // Nothing the value contributed is left escaping the character after it —
    // the first casualty of a stray escape is the span's own closing backtick.
    expect(strayEscapes(span)).toEqual([]);
  });
});

// The characters the row scanner would consume as escaped, minus the backslash
// and pipe that `escapeCell` deliberately puts in that position. Anything else
// means a backslash from the value is still live at the block level.
function strayEscapes(span: string): string[] {
  const stray: string[] = [];
  for (let index = 0; index < span.length; index++) {
    if (span[index] !== '\\') {
      continue;
    }
    const escaped = span[index + 1] ?? '';
    if (escaped !== '\\' && escaped !== '|') {
      stray.push(escaped);
    }
    index++;
  }
  return stray;
}
