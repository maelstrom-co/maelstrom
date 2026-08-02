import { describe, expect, it } from 'bun:test';
import type { Config } from '../config/config.ts';
import { capturedLog } from '../fixtures/captured-log.ts';
import { COMMENT_MARKER } from '../render/comment-marker.ts';
import { createFindComment } from './find-comment.ts';
import type { Pages } from './pages.ts';
import type { ViewerLogin } from './viewer-login.ts';

const VIEWER = 'github-actions[bot]';
const CONFIG: Config = {
  token: 'ghs_token',
  repository: 'maelstrom-co/maelstrom',
  prNumber: '7',
  headSha: '0123456789abcdef0123456789abcdef01234567',
  isFork: false,
};
const COMMENTS_URL =
  'https://api.github.com/repos/maelstrom-co/maelstrom/issues/7/comments';

describe('findComment', () => {
  it('returns the id of our own marked comment', async () => {
    const requested: Array<[string, string, number]> = [];
    const findComment = createFindComment(
      resolving(VIEWER),
      recording(requested, [[ours(1234567)]]),
    );
    expect(await findComment(CONFIG)).toBe(1234567);
    expect(requested).toEqual([[CONFIG.token, COMMENTS_URL, 20]]);
  });

  it('keeps paging until it finds the marker', async () => {
    const findComment = createFindComment(
      resolving(VIEWER),
      pagesOf([[theirs(1), theirs(2)], [ours(99)]]),
    );
    expect(await findComment(CONFIG)).toBe(99);
  });

  it('reports no comment when nothing on any page is ours', async () => {
    const findComment = createFindComment(
      resolving(VIEWER),
      pagesOf([[theirs(1)], [theirs(2)]]),
    );
    expect(await findComment(CONFIG)).toBeUndefined();
  });

  it('reports no comment, loudly, when the identity is unknown', async () => {
    // Without our own login nothing can prove a comment is ours, and a PATCH
    // against an unproven comment overwrites whoever does own it. The cost of
    // failing shut is a duplicate comment per push, which must not pass
    // silently. `refusing` throws if consulted, pinning the gate ahead of the
    // paging: no page of results could be interpreted without an identity.
    const findComment = createFindComment(resolving(undefined), refusing);
    const { result, lines } = await capturedLog(() => findComment(CONFIG));
    expect(result).toBeUndefined();
    expect(lines).toEqual([
      '::warning title=DCO::could not confirm which comment belongs to this workflow — posting a new verdict comment instead of updating the existing one',
    ]);
  });
});

function resolving(login: string | undefined): ViewerLogin {
  return async () => login;
}

function pagesOf(payloads: unknown[][]): Pages {
  return async function* () {
    yield* payloads;
  };
}

function recording(
  requested: Array<[string, string, number]>,
  payloads: unknown[][],
): Pages {
  return async function* (token, url, pageLimit) {
    requested.push([token, url, pageLimit]);
    yield* payloads;
  };
}

const refusing: Pages = () => {
  throw new Error('the comment list must not be read without an identity');
};

function ours(id: number): unknown {
  return {
    id,
    user: { login: VIEWER, type: 'Bot' },
    body: `${COMMENT_MARKER}\n\n## DCO`,
  };
}

function theirs(id: number): unknown {
  return {
    id,
    user: { login: 'ada', type: 'User' },
    body: 'nice work on this PR',
  };
}
