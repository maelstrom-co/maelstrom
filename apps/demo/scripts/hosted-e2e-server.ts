/// <reference types="bun" />
/**
 * Serves the hosted SPA plus same-origin /ws for launch-readiness e2e.
 * Alchemy is the only Worker runtime; this is a local stand-in so Playwright
 * can exercise the hosted client without a Wrangler config.
 */
import { extname, join, resolve } from 'node:path';
import {
  headersForPath,
  parseHeaderRules,
  resolveClientFile,
} from '../src/server/hosted-headers';
import {
  createWebSocketHandlers,
  type SocketData,
} from '../src/server/ws-server';
import {
  buildHostedE2EEngine,
  denyHostedE2ENetwork,
} from './hosted-e2e-engine';

globalThis.fetch = denyHostedE2ENetwork;

const PORT = Number(process.env.HOSTED_E2E_PORT ?? 4173);
const clientRoot = resolve(import.meta.dirname, '../dist/client');
const headersFile = resolve(import.meta.dirname, '../public/_headers');

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.onnx': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream';
}

const headerRules = parseHeaderRules(await Bun.file(headersFile).text());
const websocket = createWebSocketHandlers({
  sharedEngine: null,
  sharedEngineInitError: 'No server OpenAI key configured.',
  buildBrowserEngine: buildHostedE2EEngine,
});

const server = Bun.serve<SocketData>({
  port: PORT,
  async fetch(request, srv) {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    if (url.pathname === '/ws') {
      return srv.upgrade(request, {
        data: { helloReceived: false },
      })
        ? undefined
        : new Response('WebSocket upgrade failed', { status: 400 });
    }

    const filePath = resolveClientFile(url.pathname, clientRoot);
    if (filePath === undefined) {
      return new Response('Not Found', { status: 404 });
    }

    const file = Bun.file(filePath);
    const bodyFile = (await file.exists())
      ? file
      : Bun.file(join(clientRoot, 'index.html'));
    if (!(await bodyFile.exists())) {
      return new Response('Hosted client artifact is missing', {
        status: 500,
      });
    }

    const headers = headersForPath(url.pathname, headerRules);
    headers.set('Content-Type', contentTypeFor(bodyFile.name ?? filePath));
    return new Response(bodyFile, { headers });
  },
  websocket,
});

console.log(
  `[demo e2e] hosted stand-in listening on http://127.0.0.1:${server.port}`,
);
