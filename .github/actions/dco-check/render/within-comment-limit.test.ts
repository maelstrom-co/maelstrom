import { describe, expect, it } from 'bun:test';
import { withinCommentLimit } from './within-comment-limit.ts';

describe('withinCommentLimit', () => {
  it('leaves a body that fits alone', () => {
    const body = '**DCO** ✗ 1 commit is missing a trailer.';
    expect(withinCommentLimit(body)).toBe(body);
  });

  it('truncates an over-long body and says where the rest is', () => {
    const capped = withinCommentLimit('x'.repeat(200_000));
    expect(capped.length).toBeLessThan(65_536);
    expect(capped).toContain('job log');
  });

  it('cuts by code point, so an astral body cannot lose half a pair', () => {
    // GitHub counts characters, and a cut by UTF-16 unit can land inside a
    // surrogate pair and emit a lone surrogate.
    const capped = withinCommentLimit('😀'.repeat(70_000));
    expect(Array.from(capped).length).toBeLessThan(65_536);
    expect(capped).toContain('😀…');
  });
});
