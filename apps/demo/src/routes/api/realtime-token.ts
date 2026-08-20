import { isOk } from '@maelstrom-co/protocol';
import {
  createOpenAIMinter,
  mintFailureHttpStatus,
} from '@maelstrom-co/realtime-openai-server';
import { createFileRoute } from '@tanstack/react-router';
import { DEMO_OPENAI_VOICE } from '../../lib/demo-greeting-tts';
import { DEFAULT_REALTIME_MODEL } from '../../lib/realtime-model';

/**
 * Mints ephemeral OpenAI realtime client secrets on behalf of the browser.
 * OPENAI_API_KEY never leaves this server-only minter — see
 * createOpenAIMinter for the mint contract. This route owns the HTTP
 * transport concerns (method check, body parsing, status mapping) that the
 * minter itself is agnostic to. Output voice is trusted server config only.
 */
const mint = createOpenAIMinter({
  apiKey: process.env.OPENAI_API_KEY ?? '',
  model: process.env.OPENAI_REALTIME_MODEL?.trim() || DEFAULT_REALTIME_MODEL,
  voice: DEMO_OPENAI_VOICE,
});

export async function handleRealtimeTokenRequest(
  request: Request,
): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 400 });
  }

  let body: unknown;
  let malformed = false;
  try {
    body = await request.json();
  } catch {
    malformed = true;
  }

  // The minter checks the API key before validating input, so a single mint
  // call already gives missing-api-key precedence over a malformed body —
  // no need to probe with a throwaway mint(undefined) first.
  const result = await mint(body);
  if (isOk(result)) {
    return Response.json(result.value);
  }

  const error =
    malformed && result.error.reason === 'invalid-request'
      ? 'Malformed request body'
      : result.error.reason;

  return Response.json(
    {
      error,
      ...(result.error.reason === 'upstream-failure' && {
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
