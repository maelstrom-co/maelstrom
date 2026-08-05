import { describe, expect, it } from 'bun:test';
import { COMMENT_MARKER } from '../render/comment-marker.ts';
import { markerCommentId } from './marker-comment-id.ts';

const VIEWER = 'github-actions[bot]';

// Shaped after a real `GET /repos/{o}/{r}/issues/{n}/comments` entry, extra
// fields included: the match must keep working when GitHub adds more. Local to
// this file rather than under `fixtures/`, which is shared only because
// `commit()` has callers in several test files — this one has exactly one.
function entry(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 1234567,
    node_id: 'IC_kwDOABPHjM5aBcDe',
    url: 'https://api.github.com/repos/o/r/issues/comments/1234567',
    html_url: 'https://github.com/o/r/pull/7#issuecomment-1234567',
    user: {
      login: VIEWER,
      id: 41898282,
      node_id: 'MDM6Qm90NDE4OTgyODI=',
      type: 'Bot',
      site_admin: false,
    },
    created_at: '2026-07-30T10:00:00Z',
    updated_at: '2026-07-30T10:00:00Z',
    author_association: 'NONE',
    body: `${COMMENT_MARKER}\n\n## DCO`,
    ...overrides,
  };
}

describe('markerCommentId', () => {
  it('accepts our own marked comment', () => {
    expect(markerCommentId(entry(), VIEWER)).toBe(1234567);
  });

  it('refuses a marked comment from a different bot', () => {
    // The whole point of comparing logins: any other app installed on the repo
    // can post our marker, and without this check every later run would PATCH
    // their comment instead of ours.
    expect(
      markerCommentId(
        entry({ user: { login: 'coderabbitai[bot]', type: 'Bot' } }),
        VIEWER,
      ),
    ).toBeUndefined();
  });

  it('refuses a marked comment from a human sharing our login', () => {
    // Belt and braces: the account type is checked independently of the login,
    // so a `User` never reaches the slot even if the logins agree.
    expect(
      markerCommentId(entry({ user: { login: VIEWER, type: 'User' } }), VIEWER),
    ).toBeUndefined();
  });

  it('refuses our own comment when it carries no marker', () => {
    expect(
      markerCommentId(entry({ body: 'nice work on this PR' }), VIEWER),
    ).toBeUndefined();
  });

  it('compares the REST login against the GraphQL viewer login verbatim', () => {
    // REST reports a bot commenter as `github-actions[bot]` and GraphQL's
    // `viewer { login }` returns the same suffixed form, so neither side is
    // normalized. GraphQL's `Bot` node reports the bare app slug instead, and
    // sticky-comment actions built on it strip `[bot]` before comparing —
    // copying that here would make the match fail on every run, silently.
    expect(
      markerCommentId(entry({ user: { login: VIEWER, type: 'Bot' } }), VIEWER),
    ).toBe(1234567);
    expect(
      markerCommentId(
        entry({ user: { login: 'github-actions', type: 'Bot' } }),
        VIEWER,
      ),
    ).toBeUndefined();
  });

  it('compares logins case-sensitively', () => {
    // Both sides are GitHub's own canonical spelling of one account, so a
    // difference in case means the identity assumption broke rather than that
    // casing drifted — and "not ours" is the safe reading of that.
    expect(
      markerCommentId(
        entry({ user: { login: 'GitHub-Actions[bot]', type: 'Bot' } }),
        VIEWER,
      ),
    ).toBeUndefined();
  });

  it('refuses an entry that is not an object', () => {
    expect(markerCommentId(null, VIEWER)).toBeUndefined();
    expect(markerCommentId('nope', VIEWER)).toBeUndefined();
    expect(markerCommentId(undefined, VIEWER)).toBeUndefined();
  });

  it('refuses an entry carrying no user', () => {
    expect(markerCommentId(entry({ user: undefined }), VIEWER)).toBeUndefined();
    expect(markerCommentId(entry({ user: null }), VIEWER)).toBeUndefined();
    expect(markerCommentId(entry({ user: 'ada' }), VIEWER)).toBeUndefined();
  });

  it('refuses a non-string body rather than coercing it', () => {
    // A malformed payload must never be read as a marked comment, so `body`
    // is type-checked before the marker search rather than stringified.
    expect(markerCommentId(entry({ body: undefined }), VIEWER)).toBeUndefined();
    expect(markerCommentId(entry({ body: 42 }), VIEWER)).toBeUndefined();
    expect(
      markerCommentId(entry({ body: { text: COMMENT_MARKER } }), VIEWER),
    ).toBeUndefined();
  });

  it('refuses a comment whose id is not a number', () => {
    // The id is fed straight into a PATCH URL, so a string id is a malformed
    // payload rather than something to coerce.
    expect(markerCommentId(entry({ id: '1234567' }), VIEWER)).toBeUndefined();
    expect(markerCommentId(entry({ id: undefined }), VIEWER)).toBeUndefined();
  });
});
