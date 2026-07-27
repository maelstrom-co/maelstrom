/// <reference types="@cloudflare/workers-types" />
/**
 * Cloudflare Worker entry for the hosted playground. Routes /ws to the
 * PlaygroundServer container (ws-server.ts, HOSTED=1) and everything else
 * to the static SPA build. OpenAI's client_secrets endpoint answers
 * browser-direct requests, so voice token minting happens entirely
 * client-side and there is no /api/mint route here.
 */
import { Container, getContainer } from '@cloudflare/containers';
import { shardInstanceName } from './shard';

export class PlaygroundServer extends Container<Env> {
  override defaultPort = 3001;
  // Coupled to IDLE_TTL_MS in server/ws-server.ts — must never be shorter
  // than that value. Sleeping destroys the container's in-memory session
  // registry outright, so if this fires before the idle TTL, the TTL's
  // "abandoned session" contract is a lie: a visitor who reconnects on the
  // same sessionId after the container slept gets a silently blank engine.
  override sleepAfter = '10m';
  // No provider keys here -- BYOK keys live only in the visitor's browser
  // and travel over the WebSocket's playground.hello handshake, never as
  // container env.
  override envVars = { HOSTED: '1' };
}

interface Env {
  PLAYGROUND_SERVER: DurableObjectNamespace<PlaygroundServer>;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      // Container.fetch() calls startAndWaitForPorts() when the instance
      // isn't running and renewActivityTimeout() on every proxied request --
      // so a plain unauthenticated GET would cold-start an instance and keep
      // it warm with no upgrade ever happening. Rejecting before
      // getContainer() is called means a non-upgrade request never touches
      // the container at all. This doesn't stop a well-formed upgrade
      // request from doing the same thing deliberately; that needs edge
      // rate limiting, out of scope here.
      const upgrade = request.headers.get('Upgrade');
      if (upgrade?.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }

      // WebSocket proxying is transparent bidirectional pass-through via
      // the DO's fetch() only -- containerFetch() does not support
      // WebSockets. getContainer() defaults to a single fixed instance id
      // when none is passed, so routing on the connector-supplied `session`
      // query param (see connector.ts) is what actually spreads visitors
      // across the container's `max_instances` provisions instead of
      // funneling all of them onto one.
      const session = url.searchParams.get('session') ?? '';
      return getContainer(
        env.PLAYGROUND_SERVER,
        shardInstanceName(session),
      ).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
