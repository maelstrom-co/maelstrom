export {};

let calls = 0;
let requestId: string | null = null;
globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
  if (
    !String(input).startsWith(
      'https://api.github.com/repos/fixture/ci/actions/workflows/ci.yml/runs?branch=main&event=push',
    )
  ) {
    throw new Error('Unexpected fixture request');
  }
  const headers = new Headers(init?.headers);
  if (headers.get('authorization') !== 'Bearer fixture')
    throw new Error('Missing fixture authorization');
  const currentId = headers.get('x-request-id');
  if (!currentId || !/^[0-9a-f-]{36}$/.test(currentId))
    throw new Error('Missing correlation ID');
  if (requestId && currentId !== requestId)
    throw new Error('Correlation changed across attempts');
  requestId = currentId;
  calls += 1;
  const responseHeaders = { 'x-github-request-id': `ABCD:${calls}` };
  if (process.env.LOOKUP_HTTP_FAILURE === '1') {
    return new Response('do-not-log-response', {
      status: 503,
      headers: responseHeaders,
    });
  }
  if (process.env.LOOKUP_INVALID_REVISION === '1') {
    return Response.json(
      {
        workflow_runs: [
          { id: 1, conclusion: 'success', head_sha: 'do-not-log-response' },
        ],
      },
      { headers: responseHeaders },
    );
  }
  return Response.json(
    {
      workflow_runs:
        calls === 1
          ? []
          : [{ id: 1, head_sha: 'a'.repeat(40), conclusion: 'success' }],
      private_payload: 'do-not-log-response',
    },
    { headers: responseHeaders },
  );
}) as typeof fetch;
