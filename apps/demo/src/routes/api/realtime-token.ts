import { isOk, SessionIdSchema } from '@maelstrom-co/protocol';
import {
  createOpenAIMinter,
  mintFailureHttpStatus,
} from '@maelstrom-co/realtime-openai-server';
import { OpenAITokenGrantSchema } from '@maelstrom-co/realtime-protocol/openai';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { DEMO_OPENAI_VOICE } from '../../lib/demo-greeting-tts';
import { withFetchTimeout } from '../../lib/fetch-timeout';
import { DEFAULT_REALTIME_MODEL } from '../../lib/realtime-model';
import {
  LIVE_TRANSCRIPTION_MODEL,
  LIVE_TRANSCRIPTION_SESSION,
} from '../../talking-points/live-transcription-config';

const apiKey = process.env.OPENAI_API_KEY ?? '';
const transcriptionRequestSchema = z
  .object({
    provider: z.literal('openai'),
    sessionId: SessionIdSchema,
    intent: z.literal('talking-points-transcription'),
  })
  .strict();

async function mintTranscription(
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  if (!apiKey)
    return Response.json({ error: 'missing-api-key' }, { status: 500 });
  if (!transcriptionRequestSchema.safeParse(body).success) {
    return Response.json({ error: 'invalid-request' }, { status: 400 });
  }
  try {
    const upstream = await fetch(
      'https://api.openai.com/v1/realtime/client_secrets',
      {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          expires_after: { anchor: 'created_at', seconds: 600 },
          session: LIVE_TRANSCRIPTION_SESSION,
        }),
        signal: withFetchTimeout(signal),
      },
    );
    if (!upstream.ok) {
      return Response.json(
        { error: 'upstream-failure', upstreamStatus: upstream.status },
        { status: 502 },
      );
    }
    const data = z
      .object({ value: z.string().min(1), expires_at: z.number() })
      .parse(await upstream.json());
    const grant = OpenAITokenGrantSchema.parse({
      provider: 'openai',
      value: data.value,
      expiresAt: data.expires_at,
      model: LIVE_TRANSCRIPTION_MODEL,
    });
    return Response.json(grant);
  } catch {
    return Response.json({ error: 'upstream-failure' }, { status: 502 });
  }
}

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

  if (
    typeof body === 'object' &&
    body !== null &&
    Object.hasOwn(body, 'intent')
  ) {
    return mintTranscription(body, request.signal);
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
