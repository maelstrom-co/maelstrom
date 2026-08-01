import { describe, expect, it } from 'bun:test';
import { createGraphqlRequest } from './graphql-request.ts';
import type { Request } from './request.ts';

const TOKEN = 'ghs_token';
const GRAPHQL_URL = 'https://api.github.com/graphql';
const QUERY = 'query { viewer { login } }';

describe('graphqlRequest', () => {
  it('posts the query to the GraphQL endpoint', async () => {
    let sent: { url: string; init?: RequestInit } | undefined;
    const graphqlRequest = createGraphqlRequest(async (_token, url, init) => {
      sent = { url, init };
      return { data: {} };
    });
    await graphqlRequest(TOKEN, QUERY);
    expect(sent?.url).toBe(GRAPHQL_URL);
    expect(sent?.init?.method).toBe('POST');
    expect(sent?.init?.body).toBe(JSON.stringify({ query: QUERY }));
  });

  it('returns the payload of a query that carried no errors', async () => {
    const graphqlRequest = createGraphqlRequest(
      responding({ data: { viewer: { login: 'github-actions[bot]' } } }),
    );
    expect(await graphqlRequest(TOKEN, QUERY)).toEqual({
      data: { viewer: { login: 'github-actions[bot]' } },
    });
  });

  it('throws on a 200 that carries a top-level errors array', async () => {
    // The trap: a rejected GraphQL query is an HTTP 200, so nothing the status
    // check in `request` does can catch it, and `data` arrives full of nulls.
    // Without this the caller reads a denial as an empty answer.
    const graphqlRequest = createGraphqlRequest(
      responding({
        data: { viewer: null },
        errors: [
          { message: 'Bad credentials' },
          { message: 'Resource not accessible by integration' },
        ],
      }),
    );
    await expect(graphqlRequest(TOKEN, QUERY)).rejects.toThrow(
      `POST ${GRAPHQL_URL} → 200 with errors — Bad credentials; Resource not accessible by integration`,
    );
  });

  it('reports an error entry whose message is missing', async () => {
    const graphqlRequest = createGraphqlRequest(
      responding({ errors: [{ type: 'FORBIDDEN' }] }),
    );
    await expect(graphqlRequest(TOKEN, QUERY)).rejects.toThrow(
      `POST ${GRAPHQL_URL} → 200 with errors`,
    );
  });

  it('treats an empty errors array as a success', async () => {
    const graphqlRequest = createGraphqlRequest(
      responding({ data: { viewer: { login: 'ada' } }, errors: [] }),
    );
    expect(await graphqlRequest(TOKEN, QUERY)).toEqual({
      data: { viewer: { login: 'ada' } },
      errors: [],
    });
  });

  it('treats a non-object payload as a success', async () => {
    // Nothing here validates the shape of a good answer — that is the caller's
    // job, and inventing a failure would report the wrong cause.
    const graphqlRequest = createGraphqlRequest(responding(null));
    expect(await graphqlRequest(TOKEN, QUERY)).toBeNull();
  });
});

function responding(payload: unknown): Request {
  return async () => payload;
}
