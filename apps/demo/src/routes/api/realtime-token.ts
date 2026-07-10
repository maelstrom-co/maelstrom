import { createFileRoute } from '@tanstack/react-router';
import { isErr, isOk } from '@maelstrom-co/protocol';
import { createOpenAIMinter, mintFailureHttpStatus } from '@maelstrom-co/realtime-server';

/**
 * Mints ephemeral OpenAI realtime client secrets on behalf of the browser.
 * OPENAI_API_KEY never leaves this server-only minter — see
 * createOpenAIMinter for the mint contract. This route owns the HTTP
 * transport concerns (method check, body parsing, status mapping) that the
 * minter itself is agnostic to.
 */
const mint = createOpenAIMinter({
  apiKey: process.env.OPENAI_API_KEY ?? '',
  model: 'gpt-realtime-2',
});

export async function handleRealtimeTokenRequest(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // A malformed body can't be distinguished from a client error until we
    // rule out server misconfiguration first — `undefined` never validates,
    // so this reuses the minter's own apiKey check instead of duplicating it.
    const misconfigured = await mint(undefined);
    if (isErr(misconfigured) && misconfigured.error.reason === 'missing-api-key') {
      return Response.json(
        { error: misconfigured.error.reason },
        { status: mintFailureHttpStatus(misconfigured.error.reason) },
      );
    }
    return Response.json({ error: 'Malformed request body' }, { status: 400 });
  }

  const result = await mint(body);
  if (isOk(result)) {
    return Response.json(result.value);
  }

  return Response.json(
    {
      error: result.error.reason,
      ...(result.error.upstreamStatus !== undefined && {
        upstreamStatus: result.error.upstreamStatus,
      }),
    },
    { status: mintFailureHttpStatus(result.error.reason) },
  );
}

export const Route = createFileRoute('/api/realtime-token')({
  server: {
    handlers: {
      POST: ({ request }) => handleRealtimeTokenRequest(request),
    },
  },
});
