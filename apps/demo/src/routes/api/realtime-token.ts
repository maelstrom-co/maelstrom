import { createFileRoute } from '@tanstack/react-router';
import { createOpenAIMinter, type MintFailureReason } from '@maelstrom-co/realtime-server';

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

const FAILURE_STATUS: Record<MintFailureReason, number> = {
  'invalid-request': 400,
  'unsupported-provider': 400,
  'missing-api-key': 500,
  'upstream-failure': 502,
};

export async function handleRealtimeTokenRequest(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Malformed request body' }, { status: 400 });
  }

  const result = await mint(body);
  if (result.ok) {
    return Response.json(result.response);
  }

  return Response.json(
    {
      error: result.reason,
      ...(result.upstreamStatus !== undefined && { upstreamStatus: result.upstreamStatus }),
    },
    { status: FAILURE_STATUS[result.reason] },
  );
}

export const Route = createFileRoute('/api/realtime-token')({
  server: {
    handlers: {
      POST: ({ request }) => handleRealtimeTokenRequest(request),
    },
  },
});
