import { describe, expect, it } from 'bun:test';
import { COMMENT_MARKER } from './comment-marker.ts';
import { CONTRIBUTING_DCO_URL } from './contributing-dco-url.ts';
import { unauditableBody } from './unauditable-body.ts';

describe('unauditableBody', () => {
  it('opens with the marker, exactly once', () => {
    // The marker is how the next run finds this comment to edit in place; a
    // second occurrence would make the find step ambiguous.
    const body = unauditableBody('the endpoint returned no commits');
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body.split(COMMENT_MARKER)).toHaveLength(2);
  });

  it('names the reason the audit did not happen', () => {
    const body = unauditableBody('the endpoint returned no commits');
    expect(body).toContain('the endpoint returned no commits');
    expect(body).toContain('✗');
    expect(body).toContain(CONTRIBUTING_DCO_URL);
  });

  it('refuses to render a reason carrying the marker', () => {
    expect(() => unauditableBody(`ends at ${COMMENT_MARKER}`)).toThrow(
      'exactly once',
    );
  });
});
