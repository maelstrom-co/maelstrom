import type { SessionId } from '@maelstrom-co/protocol';
import {
  type OpenAITokenGrant,
  OpenAITokenGrantSchema,
} from '@maelstrom-co/realtime/openai';
import { withFetchTimeout } from './fetch-timeout';

/**
 * Narrows OpenAI's client_secrets response just enough to read `value` and
 * `expires_at` safely — mirrors the local mint route's unknown-then-parse
 * idiom instead of asserting a shape the network response never promised.
 */
function readOpenaiClientSecret(body: unknown): { value: string; expiresAt: number } {
  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as { value?: unknown }).value !== 'string' ||
    typeof (body as { expires_at?: unknown }).expires_at !== 'number'
  ) {
    throw new Error('Unexpected response shape from OpenAI client_secrets.');
  }
  const { value, expires_at } = body as { value: string; expires_at: number };
  return { value, expiresAt: expires_at };
}

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
    signal: withFetchTimeout(),
  });
  if (!res.ok) {
    throw new Error(`Token mint failed with status ${res.status}`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    // A 200 with a non-JSON body (captive portal / TLS-proxy interstitial)
    // throws SyntaxError from res.json() — that message otherwise propagates
    // verbatim into the caller's error surface.
    throw new Error('Received an unexpected response from the token mint route.');
  }
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

    let res: Response;
    try {
      res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        // expires_after is sent explicitly rather than left to OpenAI's
        // default so both mint paths pin the same token lifetime — a
        // default that shifts under us would silently change it for
        // browser-direct visitors only.
        body: JSON.stringify({
          expires_after: { anchor: 'created_at', seconds: 600 },
          session: { type: 'realtime', model },
        }),
        signal: withFetchTimeout(),
      });
    } catch {
      // A rejected fetch (offline, DNS, a proxy blocking api.openai.com)
      // surfaces a raw 'Failed to fetch' otherwise — that reads as "your key
      // is bad" once it lands in the key drawer's error slot, which sends
      // visitors to replace a perfectly good key.
      throw new Error('Could not reach OpenAI — check your connection and try again.');
    }

    if (!res.ok) {
      if (res.status === 401) {
        throw new Error('Invalid API key.');
      }
      throw new Error(`Failed to mint a realtime token (status ${res.status}).`);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      // A captive portal or corporate TLS proxy can answer 200 with an HTML
      // interstitial — res.json() then throws a raw SyntaxError that reads
      // as "your key is broken" once it lands in the key drawer, which is
      // exactly the failure mode the surrounding try/catch exists to avoid.
      throw new Error('Could not reach OpenAI — check your connection and try again.');
    }
    const data = readOpenaiClientSecret(json);
    return OpenAITokenGrantSchema.parse({
      provider: 'openai',
      value: data.value,
      expiresAt: data.expiresAt,
      model,
    });
  };
}
