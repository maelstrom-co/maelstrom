import type { SessionId } from '@maelstrom-co/protocol';
import {
  type OpenAITokenGrant,
  OpenAITokenGrantSchema,
} from '@maelstrom-co/realtime/openai';

/**
 * Fetches an ephemeral OpenAI realtime credential from the demo's mint
 * route. The browser never sees OPENAI_API_KEY — only this short-lived
 * token, scoped and expired server-side.
 */
export async function mintOpenAIToken(
  sessionId: SessionId,
): Promise<OpenAITokenGrant> {
  const res = await fetch('/api/realtime-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'openai', sessionId }),
  });
  if (!res.ok) {
    throw new Error(`Token mint failed with status ${res.status}`);
  }
  const body: unknown = await res.json();
  return OpenAITokenGrantSchema.parse(body);
}

/**
 * Direct-mint branch: calls OpenAI's client_secrets endpoint from the
 * browser with the visitor's own key (api.openai.com answers browser CORS
 * for this route). Mirrors packages/realtime-server's openai-mint.ts field
 * mapping.
 */
export function createBrowserMintToken(
  getApiKey: () => string | null,
  model: string,
): () => Promise<OpenAITokenGrant> {
  return async () => {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('No API key set — open the key drawer to add one.');
    }

    const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ session: { type: 'realtime', model } }),
    });

    if (!res.ok) {
      if (res.status === 401) {
        throw new Error('Invalid API key.');
      }
      throw new Error(`Failed to mint a realtime token (status ${res.status}).`);
    }

    const data = (await res.json()) as { value: string; expires_at: number };
    return OpenAITokenGrantSchema.parse({
      provider: 'openai',
      value: data.value,
      expiresAt: data.expires_at,
      model,
    });
  };
}

/**
 * Proxy branch: posts to the Worker's stateless /api/mint route, which
 * forwards the visitor's key to OpenAI server-side and returns the mapped
 * token without storing or logging it. Kept as a tested fallback in case
 * Cloudflare's CORS posture toward api.openai.com changes and the
 * direct-mint branch stops working.
 */
export function createProxyMintToken(
  getApiKey: () => string | null,
  model: string,
): () => Promise<OpenAITokenGrant> {
  return async () => {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('No API key set — open the key drawer to add one.');
    }

    const res = await fetch('/api/mint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, model }),
    });

    if (!res.ok) {
      if (res.status === 401) {
        throw new Error('Invalid API key.');
      }
      throw new Error(`Failed to mint a realtime token (status ${res.status}).`);
    }

    return OpenAITokenGrantSchema.parse(await res.json());
  };
}
