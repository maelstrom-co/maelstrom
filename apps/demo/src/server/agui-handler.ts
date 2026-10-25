import { RunAgentInputSchema } from '@ag-ui/core/schemas';
import {
  EventType,
  type StreamChunk,
  toServerSentEventsResponse,
} from '@tanstack/ai';
import { z } from 'zod';
import { OperationSchema } from '../lib/agui-contract';
import { createAgentEngine, DemoAgentEngine } from './agui-engine';

const StartSchema = z.object({
  sessionId: z.string().uuid(),
  mode: z.enum(['fixture', 'live']),
  apiKey: z.string().min(1).max(512).optional(),
});
const sessions = new Map<
  string,
  { engine: DemoAgentEngine; expires: ReturnType<typeof setTimeout> }
>();
const lifetime = 10 * 60 * 1000;

export async function handleAguiRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (
    process.env.VITE_HOSTED === '1' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    return new Response('Local experiment only', { status: 404 });
  if (request.headers.get('origin') !== url.origin)
    return new Response('Same origin required', { status: 403 });
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  const session = token ? sessions.get(token) : undefined;
  if (request.method === 'DELETE') {
    if (session && token) {
      session.engine.close();
      clearTimeout(session.expires);
      sessions.delete(token);
    }
    return new Response(null, { status: 204 });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  try {
    const text = await request.text();
    if (text.length > 256_000)
      return new Response('Request too large', { status: 413 });
    const body: unknown = JSON.parse(text);
    if (!token) {
      const start = StartSchema.parse(body);
      if (sessions.size >= 32)
        return new Response('Experiment capacity reached', { status: 503 });
      const id = crypto.randomUUID();
      const engine = new DemoAgentEngine(
        start.sessionId,
        createAgentEngine(start.mode, start.apiKey),
      );
      const expires = setTimeout(() => {
        engine.close();
        sessions.delete(id);
      }, lifetime);
      expires.unref?.();
      sessions.set(id, { engine, expires });
      return Response.json(
        { token: id },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (!session)
      return new Response('Session expired; never replay uncertain writes', {
        status: 410,
      });
    const input = RunAgentInputSchema.parse(body);
    if (
      input.threadId !== session.engine.sessionId ||
      input.tools.length ||
      input.messages.length
    )
      throw new Error('Unexpected run');
    const operation = OperationSchema.parse(input.forwardedProps);
    const engine = session.engine;
    const abort = () => engine.close();
    request.signal.addEventListener('abort', abort, { once: true });
    async function* events(): AsyncGenerator<StreamChunk> {
      yield {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
        timestamp: Date.now(),
      };
      try {
        const value = await engine.run(input.runId, operation);
        yield {
          type: 'CUSTOM',
          name: operation.kind === 'plan' ? 'demo:workspace' : 'demo:state',
          value,
          timestamp: Date.now(),
        };
        yield {
          type: EventType.RUN_FINISHED,
          threadId: input.threadId,
          runId: input.runId,
          timestamp: Date.now(),
        };
      } catch {
        engine.close();
        yield {
          type: EventType.RUN_ERROR,
          message:
            'Experimental session stopped. Application outcome may be unknown. Do not repeat the write automatically.',
          timestamp: Date.now(),
        };
      } finally {
        request.signal.removeEventListener('abort', abort);
      }
    }
    return toServerSentEventsResponse(events(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    session?.engine.close();
    return new Response('Invalid experimental request', { status: 400 });
  }
}
