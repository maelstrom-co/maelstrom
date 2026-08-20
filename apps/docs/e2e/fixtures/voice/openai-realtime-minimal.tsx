interface AuthenticatedRealtimeSession {
  readonly principalId: string;
  readonly sessionId: string;
}

declare function requireAuthenticatedRealtimeSession(
  request: Request,
): Promise<AuthenticatedRealtimeSession | null>;

/* docs:openai-minimal-minter:start */
import { isOk } from '@maelstrom-co/protocol';
import {
  createOpenAIMinter,
  mintFailureHttpStatus,
} from '@maelstrom-co/realtime-openai-server';

const mint = createOpenAIMinter({
  apiKey: process.env.OPENAI_API_KEY ?? '',
  model: 'gpt-realtime-2',
});

export async function POST(request: Request): Promise<Response> {
  const authenticated = await requireAuthenticatedRealtimeSession(request);
  if (authenticated === null) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const result = await mint({
    provider: 'openai',
    sessionId: authenticated.sessionId,
    model: 'gpt-realtime-2',
  });
  if (!isOk(result)) {
    return Response.json(
      { error: 'mint-failed' },
      { status: mintFailureHttpStatus(result.error.reason) },
    );
  }

  return Response.json(result.value, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
/* docs:openai-minimal-minter:end */
