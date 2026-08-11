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
      // doesn't stop a well-formed upgrade request from doing the same
      // thing deliberately; that needs edge rate limiting, out of scope
      // here. (SessionDO.fetch carries the same guard itself -- defence in
      // depth, not redundancy: this one avoids waking the object, the DO's
      // own guard protects any caller that reaches it directly.)
      const upgrade = request.headers.get('Upgrade');
      if (upgrade?.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }

      // Session identity IS object identity — this replaces shard.ts's
      // hash-based bucketing, which existed only to spread visitors across
      // five pre-provisioned containers. SessionDO holds exactly one
      // #engine/#engineKey slot per object (unlike the old container's
      // SessionEngineManager, which kept one engine per protocol sessionId
      // *within* a shared shard bucket) -- so a missing/empty session must
      // be rejected outright rather than defaulted. Defaulting every
      // session-less visitor onto one shared 'anonymous' object would let
      // them thrash one engine, and two visitors presenting the same key
      // would see each other's conversation history. The shipped client
      // (connector.ts's buildWsUrl/routingSession) always generates a
      // non-empty SessionId() in hosted mode, so this never rejects real
      // traffic.
      const session = url.searchParams.get('session');
      if (!session) {
        return new Response('Missing session query param', { status: 400 });
      }
      return env.SESSION_DO.get(env.SESSION_DO.idFromName(session)).fetch(
        request,
      );
    }

    return env.ASSETS.fetch(request);
  },
};
