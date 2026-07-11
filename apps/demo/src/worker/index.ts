/// <reference types="@cloudflare/workers-types" />
/**
 * Cloudflare Worker entry for the hosted playground. Routes /ws to the
 * PlaygroundServer container (ws-server.ts, HOSTED=1) and everything else
 * to the static SPA build. The CORS spike found OpenAI's client_secrets
 * endpoint answers browser-direct requests, so there is no /api/mint
 * route here -- voice token minting happens entirely client-side.
 */
import { Container, getContainer } from '@cloudflare/containers';

export class PlaygroundServer extends Container<Env> {
  override defaultPort = 3001;
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
      // WebSocket proxying is transparent bidirectional pass-through via
      // the DO's fetch() only -- containerFetch() does not support
      // WebSockets.
      return getContainer(env.PLAYGROUND_SERVER).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
