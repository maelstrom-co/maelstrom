import { describe, expect, it } from 'bun:test';
import { commit } from '../fixtures/commit.ts';
import { COMMENT_MARKER } from './comment-marker.ts';
import { renderComment } from './render-comment.ts';
import { signed } from './test-helpers/signed.ts';

describe('renderComment', () => {
  it('opens with the marker, exactly once', () => {
    // The marker is how the next run finds this comment to edit in place; a
    // second occurrence would make the find step ambiguous.
    const body = renderComment([signed], false);
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body.split(COMMENT_MARKER)).toHaveLength(2);
  });

  it('holds that even when a commit carries the marker in its identity', () => {
    const body = renderComment(
      [
        {
          commit: commit({
            authorName: `Ada ${COMMENT_MARKER}`,
            authorEmail: `${COMMENT_MARKER}@example.com`,
          }),
          state: 'violation',
          reason: 'email-mismatch',
          signedOffAs: [COMMENT_MARKER],
        },
      ],
      false,
    );
    expect(body.split(COMMENT_MARKER)).toHaveLength(2);
  });
});
