import { API_BASE } from './api-base.ts';
import { asRecord } from './as-record.ts';
import { request } from './request.ts';

export async function graphqlRequest(
  token: string,
  query: string,
): Promise<unknown> {
  const payload = await request(token, GRAPHQL_URL, {
    method: 'POST',
    body: JSON.stringify({ query }),
  });
  // The trap a REST caller never has to think about: GraphQL answers a rejected
  // query with HTTP 200 and a top-level `errors` array, so `request()` — which
  // only inspects the status — hands that failure back as a success with a
  // `data` of nulls. Every GraphQL caller has to re-check here or it will read
  // an unauthorized, rate-limited, or malformed query as an empty answer.
  const errors = asRecord(payload)?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const detail = errors
      .map((error) => asRecord(error)?.message)
      .filter((message) => typeof message === 'string')
      .join('; ');
    throw new Error(`POST ${GRAPHQL_URL} → 200 with errors — ${detail}`);
  }
  return payload;
}

// One caller, so it stays here rather than joining `API_BASE` in its own file —
// but it is built from `API_BASE` so the host is still declared exactly once.
const GRAPHQL_URL = `${API_BASE}/graphql`;
