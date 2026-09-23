import { createLiveSessionExchange } from '@maelstrom-co/realtime-openai-live-server';
import {
  LiveExchangeRequestSchema,
  LiveTransportError,
} from '@maelstrom-co/realtime-protocol/openai-live';

export function createLocalLiveHandler(
  apiKey: string,
  requestFetch?: typeof fetch,
  authorize: (request: Request) => boolean = () => false,
) {
  return async (request: Request): Promise<Response> => {
    const headers = { 'Cache-Control': 'no-store' };
    const fail = (status: number, accessDenied = false) =>
      Response.json(
        { error: 'Live session exchange failed' },
        {
          status,
          headers: {
            ...headers,
            ...(accessDenied ? { 'X-Maelstrom-Live-Access': 'denied' } : {}),
          },
        },
      );
    if (request.method !== 'POST') return fail(405);
    if (!authorize(request)) return fail(403, true);
    if (
      request.headers.get('origin') !== new URL(request.url).origin ||
      request.headers.get('sec-fetch-site') !== 'same-origin'
    )
      return fail(403, true);
    if (!apiKey.trim()) return fail(503);
    try {
      const reader = request.body?.getReader();
      if (!reader) return fail(400);
      let text = '';
      let size = 0;
      const decoder = new TextDecoder();
      const readTimeout = Symbol('read_timeout');
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          (async () => {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              size += chunk.value.byteLength;
              if (size > 262_144) throw new RangeError('Request too large');
              text += decoder.decode(chunk.value, { stream: true });
            }
            text += decoder.decode();
          })(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(readTimeout), 5000);
          }),
        ]);
      } catch (error) {
        if (error === readTimeout) return fail(408);
        if (error instanceof RangeError) return fail(413);
        throw error;
      } finally {
        clearTimeout(timeout);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return fail(400);
      }
      const parsed = LiveExchangeRequestSchema.safeParse(body);
      if (!parsed.success) return fail(400);
      const { session } = parsed.data;
      const backend = session.delegation.responses;
      if (
        session.model !== 'gpt-live-1' ||
        backend.model !== 'gpt-6-luna' ||
        session.store === true ||
        backend.tools?.some(
          (tool) =>
            tool.type !== 'function' ||
            !['update_ui', 'get_ui_state', 'get_capabilities'].includes(
              tool.name,
            ),
        )
      )
        return fail(400);
      const exchange = createLiveSessionExchange({
        apiKey,
        fetch: requestFetch,
      });
      const answer = await exchange(
        { ...parsed.data, session: { ...session, store: false } },
        request.signal,
      );
      return Response.json(answer, { status: 201, headers });
    } catch (error) {
      return fail(
        error instanceof LiveTransportError &&
          error.status &&
          [401, 403, 404, 429].includes(error.status)
          ? error.status
          : 502,
      );
    }
  };
}
