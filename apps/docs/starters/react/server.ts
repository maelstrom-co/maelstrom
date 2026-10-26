import { createEngine, createInMemoryStore } from '@maelstrom-co/engine';
import {
  ChartRequestMessageSchema,
  isErr,
  SessionIdSchema,
} from '@maelstrom-co/protocol';
import { createStarterPlanner, model, type StarterMode } from './planner';

/** This preview binds only to loopback; deployment requires application-owned authentication and policy. */
export function createStarterServer(
  port = 3001,
  options: {
    mode?: StarterMode;
    apiKey?: string;
    baseURL?: string;
  } = {},
) {
  if (!Number.isInteger(port) || port < 0 || port > 65_535)
    throw new Error('Use a port from 0 to 65535');
  const mode = options.mode ?? 'local';
  const engine = createEngine({
    planner: createStarterPlanner({ ...options, mode }),
    retry: false,
    history: { store: createInMemoryStore(), maxEntries: 16 },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  return Bun.serve({
    hostname: '127.0.0.1',
    port,
    maxRequestBodySize: 65_536,
    async fetch(request) {
      const url = new URL(request.url);
      const headers = {
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'",
      };
      if (!['127.0.0.1', 'localhost'].includes(url.hostname))
        return new Response('Forbidden', { status: 403, headers });
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin)
        return new Response('Forbidden', { status: 403, headers });
      if (request.method === 'GET' && url.pathname === '/api/config')
        return Response.json(
          { mode, ...(mode === 'openai' && { model }) },
          { headers },
        );
      if (request.method === 'POST' && url.pathname === '/api/process') {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json(
            { error: 'Invalid JSON' },
            { status: 400, headers },
          );
        }
        const parsed = ChartRequestMessageSchema.safeParse(body);
        if (
          !parsed.success ||
          parsed.data.request.context.layoutMode !== 'tiling' ||
          parsed.data.request.context.updateReasons.some(
            (reason) =>
              reason.type === 'user_intent' && reason.intent.length > 500,
          )
        )
          return Response.json(
            { error: 'Invalid chart request' },
            { status: 400, headers },
          );
        const result = await engine.handle(
          parsed.data,
          AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]),
        );
        if (isErr(result) || result.value.type !== 'chart_response')
          return Response.json(
            {
              error:
                mode === 'openai'
                  ? 'The model could not complete this request. Check your server configuration and try again.'
                  : 'The local Engine could not process this request',
            },
            { status: 422, headers },
          );
        return Response.json(result.value.response, { headers });
      }
      if (request.method === 'POST' && url.pathname === '/api/history') {
        try {
          const body = await request.json();
          const session = SessionIdSchema.safeParse(body?.sessionId);
          if (!session.success)
            return Response.json(
              { error: 'Invalid session' },
              { status: 400, headers },
            );
          const history = await engine.getHistory(session.data);
          return isErr(history)
            ? Response.json(
                { error: 'History unavailable' },
                { status: 422, headers },
              )
            : Response.json(history.value, { headers });
        } catch {
          return Response.json(
            { error: 'Invalid JSON' },
            { status: 400, headers },
          );
        }
      }
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return new Response('Method not allowed', { status: 405, headers });
      if (url.pathname === '/')
        return new Response(Bun.file(`${import.meta.dir}/dist/index.html`), {
          headers,
        });
      if (/^\/assets\/[a-zA-Z0-9_.-]+$/.test(url.pathname)) {
        const file = Bun.file(`${import.meta.dir}/dist${url.pathname}`);
        if (await file.exists()) return new Response(file, { headers });
      }
      return new Response('Not found', { status: 404, headers });
    },
    error() {
      return Response.json(
        { error: 'Local preview request failed' },
        { status: 500 },
      );
    },
  });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const positional = args.filter((arg) => arg !== '--live');
  if (positional.length > 1 || positional.some((arg) => !/^\d+$/.test(arg)))
    throw new Error('Usage: bun server.ts [port] [--live]');
  const server = createStarterServer(Number(positional[0] ?? 3001), {
    mode: live ? 'openai' : 'local',
    ...(live && { apiKey: process.env.OPENAI_API_KEY }),
  });
  console.log(`Maelstrom preview: http://127.0.0.1:${server.port}`);
  console.log(
    live ? `Live mode: OpenAI ${model}` : 'Local walkthrough: no model calls',
  );
}
