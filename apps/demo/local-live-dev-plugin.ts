import type { Plugin } from 'vite';
import {
  createLocalLiveAccess,
  isLoopback,
  type LocalLiveAccessOptions,
} from './src/server/local-live-access';

type LocalLiveRuntime = typeof import('./src/server/live-session');

export function localLiveDevPlugin(
  options: LocalLiveAccessOptions & { apiKey: string; fetch?: typeof fetch },
): Plugin {
  return {
    name: 'maelstrom-local-live',
    configureServer(server) {
      if (!options.enabled || options.hosted) return;
      if (
        !isLoopback(
          typeof server.config.server.host === 'string'
            ? server.config.server.host
            : undefined,
        )
      )
        throw new Error(
          'Local server-key mode requires an explicit loopback Vite host',
        );
      const authorize = createLocalLiveAccess(options);
      server.middlewares.use(async (request, response, next) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers)) {
          if (typeof value === 'string') headers.set(name, value);
          else if (value) for (const item of value) headers.append(name, item);
        }
        const peer = {
          localAddress: request.socket.localAddress,
          remoteAddress: request.socket.remoteAddress,
        };
        const bound = server.httpServer?.address();
        if (
          !bound ||
          typeof bound === 'string' ||
          !isLoopback(bound.address) ||
          !authorize(headers, peer)
        ) {
          response.writeHead(401, {
            'WWW-Authenticate':
              'Basic realm="Maelstrom local development", charset="UTF-8"',
            'Cache-Control': 'no-store',
          });
          response.end('Local development authentication required');
          return;
        }
        try {
          const url = new URL(
            request.url ?? '/',
            `http://${request.headers.host}`,
          );
          if (url.pathname !== '/api/live-session') {
            next();
            return;
          }
          const iterator = request[Symbol.asyncIterator]();
          const body = new ReadableStream<Uint8Array>({
            async pull(controller) {
              const chunk = await iterator.next();
              if (chunk.done) controller.close();
              else if (chunk.value instanceof Uint8Array)
                controller.enqueue(chunk.value);
              else controller.error(new Error('Invalid request chunk'));
            },
            cancel() {
              request.destroy();
            },
          });
          const init = {
            method: request.method,
            headers,
            ...(request.method === 'POST' ? { body, duplex: 'half' } : {}),
          };
          const incoming = new Request(url, init);
          // Config inference precedes workspace builds. The dev resolver applies
          // source conditions and invalidates application modules after edits.
          const runtime = (await server.ssrLoadModule(
            '/src/server/live-session.ts',
          )) as LocalLiveRuntime;
          const result = await runtime.createLocalLiveHandler(
            options.apiKey,
            options.fetch,
            (candidate) => authorize(candidate.headers, peer),
          )(incoming);
          response.writeHead(result.status, Object.fromEntries(result.headers));
          response.end(Buffer.from(await result.arrayBuffer()));
        } catch {
          response.writeHead(400, { 'Cache-Control': 'no-store' });
          response.end('Invalid local Live request');
        }
      });
    },
  };
}
