import {
  TokenHandshakeResponseSchema,
  type SessionId,
  type TokenHandshakeResponse,
} from '@maelstrom-co/protocol';

/**
 * Fetches an ephemeral OpenAI realtime credential from the demo's mint
 * route. The browser never sees OPENAI_API_KEY — only this short-lived
 * token, scoped and expired server-side.
 */
export async function mintOpenAiToken(
  sessionId: SessionId,
): Promise<TokenHandshakeResponse> {
  const res = await fetch('/api/realtime-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'openai', sessionId }),
  });
  if (!res.ok) {
    throw new Error(`Token mint failed with status ${res.status}`);
  }
  const body: unknown = await res.json();
  return TokenHandshakeResponseSchema.parse(body);
}
