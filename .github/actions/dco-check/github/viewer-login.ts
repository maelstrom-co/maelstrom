import type { Config } from '../config/config.ts';
import { asRecord } from './as-record.ts';
import { graphqlRequest } from './graphql-request.ts';

// `GET /user` is not available to a GitHub App installation token, which is what
// `GITHUB_TOKEN` is — GraphQL `viewer` is the one place that token can read back
// its own identity. Never throws: an unknown identity is a degraded comment
// path, and nothing about the comment may reach the verdict or the exit code.
export async function viewerLogin(config: Config): Promise<string | undefined> {
  try {
    return asLogin(await graphqlRequest(config.token, VIEWER_QUERY));
  } catch {
    return undefined;
  }
}

const VIEWER_QUERY = 'query { viewer { login } }';

function asLogin(payload: unknown): string {
  const viewer = asRecord(asRecord(payload)?.data)?.viewer;
  const login = asRecord(viewer)?.login;
  if (typeof login !== 'string' || login === '') {
    throw new Error('data.viewer.login is not a non-empty string');
  }
  return login;
}
