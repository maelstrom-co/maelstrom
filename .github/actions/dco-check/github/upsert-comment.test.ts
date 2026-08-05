import { describe, expect, it } from 'bun:test';
import type { Config } from '../config/config.ts';
import type { FindComment } from './find-comment.ts';
import type { Request } from './request.ts';
import { createUpsertComment } from './upsert-comment.ts';

const CONFIG: Config = {
  token: 'ghs_token',
  repository: 'maelstrom-co/maelstrom',
  prNumber: '7',
  headSha: '0123456789abcdef0123456789abcdef01234567',
  isFork: false,
};
const BODY = '<!-- dco-check -->\n\n**DCO** ✓';

describe('upsertComment', () => {
  it('posts a new comment when none of ours exists yet', async () => {
    const calls: Call[] = [];
    const upsertComment = createUpsertComment(
      existing(undefined),
      record(calls),
    );
    await upsertComment(CONFIG, BODY);
    expect(calls).toEqual([
      {
        token: CONFIG.token,
        url: 'https://api.github.com/repos/maelstrom-co/maelstrom/issues/7/comments',
        method: 'POST',
        body: JSON.stringify({ body: BODY }),
      },
    ]);
  });

  it('patches the comment we already own', async () => {
    // The id addresses a comment, not an issue, so the PATCH URL drops the
    // pull-request number rather than keeping it.
    const calls: Call[] = [];
    const upsertComment = createUpsertComment(existing(1234567), record(calls));
    await upsertComment(CONFIG, BODY);
    expect(calls).toEqual([
      {
        token: CONFIG.token,
        url: 'https://api.github.com/repos/maelstrom-co/maelstrom/issues/comments/1234567',
        method: 'PATCH',
        body: JSON.stringify({ body: BODY }),
      },
    ]);
  });

  it('lets a failed write propagate', async () => {
    // Swallowing belongs one level up, in `postComment`, which is where the
    // decision to keep the exit code clean is made.
    const upsertComment = createUpsertComment(existing(undefined), async () => {
      throw new Error('Resource not accessible by integration');
    });
    await expect(upsertComment(CONFIG, BODY)).rejects.toThrow(
      'Resource not accessible by integration',
    );
  });
});

interface Call {
  token: string;
  url: string;
  method: string | undefined;
  body: RequestInit['body'];
}

function existing(id: number | undefined): FindComment {
  return async () => id;
}

function record(calls: Call[]): Request {
  return async (token, url, init = {}) => {
    calls.push({ token, url, method: init.method, body: init.body });
    return {};
  };
}
