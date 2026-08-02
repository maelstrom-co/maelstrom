import { describe, expect, it } from 'bun:test';
import type { Config } from '../config/config.ts';
import { capturedLog } from '../fixtures/captured-log.ts';
import { createPostComment } from './post-comment.ts';
import { RequestError } from './request-error.ts';
import type { UpsertComment } from './upsert-comment.ts';

const CONFIG: Config = {
  token: 'ghs_token',
  repository: 'maelstrom-co/maelstrom',
  prNumber: '7',
  headSha: '0123456789abcdef0123456789abcdef01234567',
  isFork: false,
};
const BODY = '<!-- dco-check -->\n\n**DCO** ✓';
const HINT = ' — check that GITHUB_TOKEN has pull-requests: write';

describe('postComment', () => {
  it('says nothing when the comment lands', async () => {
    const delivered: Array<[Config, string]> = [];
    const postComment = createPostComment(async (config, body) => {
      delivered.push([config, body]);
    });
    const { lines } = await capturedLog(() => postComment(CONFIG, BODY));
    expect(delivered).toEqual([[CONFIG, BODY]]);
    expect(lines).toEqual([]);
  });

  it.each([
    401, 403,
  ])('reports a %i as an error naming the missing permission', async (status) => {
    // A denied comment never self-heals: every later run fails identically,
    // and a contributor staring at the check has no other explanation
    // anywhere. The annotation cannot move the exit code, so saying so
    // loudly costs nothing.
    const { lines } = await capturedLog(() =>
      createPostComment(rejecting(new RequestError(status, 'denied')))(
        CONFIG,
        BODY,
      ),
    );
    expect(lines).toEqual([
      `::error title=DCO::could not post the verdict comment (denied)${HINT}`,
    ]);
  });

  it.each([
    404, 410, 422, 500, 502,
  ])('reports a %i as a warning with no permission hint', async (status) => {
    // 422 is the one worth naming: a rejected body is our defect, not a
    // permission the repository has to grant, so the hint would misdirect.
    const { lines } = await capturedLog(() =>
      createPostComment(rejecting(new RequestError(status, 'nope')))(
        CONFIG,
        BODY,
      ),
    );
    expect(lines).toEqual([
      '::warning title=DCO::could not post the verdict comment (nope)',
    ]);
  });

  it('reports a failure that is not a RequestError as a warning', async () => {
    const { lines } = await capturedLog(() =>
      createPostComment(rejecting(new TypeError('fetch failed')))(CONFIG, BODY),
    );
    expect(lines).toEqual([
      '::warning title=DCO::could not post the verdict comment (fetch failed)',
    ]);
  });

  it('never rejects, whatever the upsert threw', async () => {
    // The check IS the verdict; the comment is UX. Nothing here may reach the
    // exit code.
    const { result } = await capturedLog(() =>
      createPostComment(rejecting('a string, not an Error'))(CONFIG, BODY),
    );
    expect(result).toBeUndefined();
  });
});

function rejecting(error: unknown): UpsertComment {
  return async () => {
    throw error;
  };
}
