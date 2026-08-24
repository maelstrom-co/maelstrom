/**
 * Cloudflare Worker entry for the hosted playground. Routes /ws to the
 * SessionDO Durable Object (session-do.ts) and everything else to the
 * static SPA build. OpenAI's client_secrets and audio/speech endpoints answer
 * browser-direct requests (hosted BYOK), so voice token minting and greeting
 * TTS happen entirely client-side. There is no /api/mint or demo greeting TTS
 * route on this Worker.
 */
import type { PlaygroundEnv } from './session-do';

export { SessionDO } from './session-do';

export default {
  async fetch(request: Request, env: PlaygroundEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      // Rejecting a non-upgrade request before touching the DO means a
      // plain unauthenticated GET never wakes the object at all. This
      // SessionDO.fetch carries the same guard itself: this one avoids waking
      // the object, while the DO's guard protects direct callers.
      const upgrade = request.headers.get('Upgrade');
      if (upgrade?.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }
      const origin = request.headers.get('Origin');
      if (origin !== null && origin !== url.origin) {
        return new Response('Cross-origin WebSocket rejected', { status: 403 });
      }
      const actor =
        request.headers.get('CF-Connecting-IP') ?? origin ?? 'unknown';
      const rateLimit = await env.WS_RATE_LIMITER.limit({
        key: `${url.host}:${actor}`,
      });
      if (!rateLimit.success) {
        return new Response('WebSocket rate limit exceeded', { status: 429 });
      }

      // Session identity is object identity. SessionDO holds exactly one
      // engine and key slot per object, so a missing or empty session must be
      // rejected rather than defaulted. Defaulting session-less visitors onto
      // one shared object would let them thrash one engine, and two visitors
      // presenting the same key would see each other's conversation history.
      const session = url.searchParams.get('session');
      if (!session) {
        return new Response('Missing session query param', { status: 400 });
      }
      if (session.length > 128) {
        return new Response('Session query param is too long', { status: 400 });
      }
      return env.SESSION_DO.get(env.SESSION_DO.idFromName(session)).fetch(
        request,
      );
    }

    return env.ASSETS.fetch(request);
  },
};
