import { describe, expect, it } from 'bun:test';
import { code } from './code.ts';
import { COMMENT_MARKER } from './comment-marker.ts';
import { row } from './row.ts';
import { backtickCount } from './test-helpers/backtick-count.ts';
import { cellsOf } from './test-helpers/cells-of.ts';
import { strayEscapes } from './test-helpers/stray-escapes.ts';

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
    ['a carriage return', 'Ada\rEVIL'],
    ['a newline', 'Ada\nEVIL'],
    ['a NUL', 'Ada\0EVIL'],
    ['a bidi override', 'Ada‮moc.elpmaxe@ada'],
    ['a zero-width space', 'Ada​Lovelace'],
    ['a zero-width joiner', 'Ada‍Lovelace'],
    ['an HTML comment', 'Ada <!-- Lovelace --> EVIL'],
  ])('renders %s as a single inert code span', (_label, value) => {
    const span = code(value);
    // Exactly one code span: the two delimiters and nothing that could close
    // it early and let the rest of the cell render as Markdown.
    expect(backtickCount(span)).toBe(2);
    expect(span.startsWith('`')).toBe(true);
    expect(span.endsWith('`')).toBe(true);
    // Asserted directly, not through `cellsOf`: that oracle models the row
    // scanner, which runs on one line and so cannot see a line ending at all —
    // it reports a row torn in two by a carriage return as a row intact.
    // Format characters are in the class for a different reason: they render as
    // nothing, or reverse what follows them, so a value holding one displays as
    // an address it is not.
    expect(span).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
    // The span fills one cell and no more: no pipe inside it survives as a
    // boundary, and it does not swallow the boundary that follows it.
    expect(cellsOf(row([span, 'next']))).toEqual([` ${span} `, ' next ']);
    // Nothing the value contributed is left escaping the character after it —
    // the first casualty of a stray escape is the span's own closing backtick.
    expect(strayEscapes(span)).toEqual([]);
  });

  it.each([
    ['is the whole value', COMMENT_MARKER],
    ['is buried in a name', `Ada ${COMMENT_MARKER} Lovelace`],
    ['is spelt with a doubled bang', '<!<!-- dco-check -->'],
  ])('leaves no usable comment marker when the value %s', (_label, value) => {
    // A code span makes the marker inert to a reader but not to the substring
    // search that finds this action's own comment to edit in place.
    expect(code(value)).not.toContain(COMMENT_MARKER);
  });

  it('leaves the brackets around an address alone', () => {
    // Only the comment opener is neutralised. An identity cell is a whole
    // `Name <email>` string, so touching every `<` mangles every honest row.
    expect(code('Ada Lovelace <ada@example.com>')).toBe(
      '`Ada Lovelace <ada@example.com>`',
    );
  });
});
