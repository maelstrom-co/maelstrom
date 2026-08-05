import { describe, expect, it } from 'bun:test';
import type { Config } from '../config/config.ts';
import { capturedLog } from '../fixtures/captured-log.ts';
import type { GraphqlRequest } from './graphql-request.ts';
import { createViewerLogin } from './viewer-login.ts';

const CONFIG: Config = {
  token: 'ghs_token',
  repository: 'maelstrom-co/maelstrom',
  prNumber: '7',
  headSha: '0123456789abcdef0123456789abcdef01234567',
  isFork: false,
};

describe('viewerLogin', () => {
  it('reads the login out of the viewer query', async () => {
    let sent: { token: string; query: string } | undefined;
    const viewerLogin = createViewerLogin(async (token, query) => {
      sent = { token, query };
      return { data: { viewer: { login: 'github-actions[bot]' } } };
    });
    const { result, lines } = await capturedLog(() => viewerLogin(CONFIG));
    expect(result).toBe('github-actions[bot]');
    expect(sent).toEqual({
      token: CONFIG.token,
      query: 'query { viewer { login } }',
    });
    expect(lines).toEqual([]);
  });

  it('warns and reports no identity when the query throws', async () => {
    // An unknown identity is a degraded comment path and nothing more; letting
    // it propagate would put the exit code at the mercy of the comment.
    const { result, lines } = await capturedLog(() =>
      createViewerLogin(rejecting(new Error('Bad credentials')))(CONFIG),
    );
    expect(result).toBeUndefined();
    expect(lines).toEqual([
      "::warning title=DCO::could not resolve this workflow's identity (Bad credentials)",
    ]);
  });

  it('warns and reports no identity when the payload carries no login', async () => {
    const { result, lines } = await capturedLog(() =>
      createViewerLogin(responding({ data: { viewer: null } }))(CONFIG),
    );
    expect(result).toBeUndefined();
    expect(lines).toEqual([
      "::warning title=DCO::could not resolve this workflow's identity (data.viewer.login is not a non-empty string)",
    ]);
  });

  it('refuses an empty login rather than passing it on', async () => {
    // An empty login would compare equal to nothing and quietly disable the
    // sticky-comment match instead of announcing that it broke.
    const { result } = await capturedLog(() =>
      createViewerLogin(responding({ data: { viewer: { login: '' } } }))(
        CONFIG,
      ),
    );
    expect(result).toBeUndefined();
  });

  it('refuses a non-string login', async () => {
    const { result } = await capturedLog(() =>
      createViewerLogin(responding({ data: { viewer: { login: 42 } } }))(
        CONFIG,
      ),
    );
    expect(result).toBeUndefined();
  });
});

function responding(payload: unknown): GraphqlRequest {
  return async () => payload;
}

function rejecting(error: Error): GraphqlRequest {
  return async () => {
    throw error;
  };
}
