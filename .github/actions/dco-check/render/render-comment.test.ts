import { describe, expect, it } from 'bun:test';
import { COMMENT_MARKER } from './comment-marker.ts';
import { renderComment } from './render-comment.ts';
import { signed } from './test-helpers/signed.ts';

describe('renderComment', () => {
  it('opens with the marker, exactly once', () => {
    // The marker is how the next run finds this comment to edit in place; a
    // second occurrence would make the find step ambiguous.
    const body = renderComment([signed]);
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body.split(COMMENT_MARKER)).toHaveLength(2);
  });
});
