import {
  type DevtoolsTargetId,
  localBridgeEndpoint,
  MAX_BRIDGE_BYTES,
  PairedSchema,
  PairingSchema,
  ReadRequestSchema,
  ReadResultSchema,
} from '@maelstrom-co/devtools-protocol';
import { createDevtoolsReader } from './mcp-reader.js';
import type { Devtools } from './types.js';

/** Explicit configuration for a local inspector connection. */
export interface DevtoolsBridgeOptions {
  /** Local listener endpoint supplied by the MCP process. */
  readonly endpoint: string;
  /** Process-scoped pairing credential, kept in memory. */
  readonly token: string;
  /** Cancels connection setup and releases the socket after pairing. */
  readonly signal?: AbortSignal;
}

/**
 * Pairs a development collector with a loopback, metadata-only inspector.
 * Rejects in production or when pairing fails. Returns idempotent socket cleanup.
 * Aborting the signal releases only this connection, including during setup.
 */
export async function connectDevtoolsBridge(
  tools: Devtools,
  options: DevtoolsBridgeOptions,
): Promise<() => void> {
  if (process.env.NODE_ENV === 'production')
    throw new Error('The local bridge is available only during development.');
  options.signal?.throwIfAborted();
  const endpoint = localBridgeEndpoint(options.endpoint);
  const pair = PairingSchema.parse({
    type: 'pair',
    version: 1,
    token: options.token,
  });
  const socket = new WebSocket(endpoint);
  const reader = createDevtoolsReader(tools);
  return new Promise((resolve, reject) => {
    let settled = false;
    let closed = false;
    let targetId: DevtoolsTargetId | undefined;
    const dispose = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      reader.dispose();
      socket.close();
    };
    const fail = () => {
      if (!settled) {
        settled = true;
        reject(new Error('Local DevTools pairing failed.'));
      }
      dispose();
    };
    const abort = () => fail();
    const timer = setTimeout(fail, 5000);
    options.signal?.addEventListener('abort', abort, { once: true });
    socket.addEventListener(
      'open',
      () => {
        if (!closed) socket.send(JSON.stringify(pair));
      },
      {
        once: true,
      },
    );
    socket.addEventListener('error', fail);
    socket.addEventListener('close', fail);
    socket.addEventListener('message', (event) => {
      if (closed) return;
      try {
        if (
          typeof event.data !== 'string' ||
          new TextEncoder().encode(event.data).byteLength > MAX_BRIDGE_BYTES ||
          socket.bufferedAmount > MAX_BRIDGE_BYTES
        ) {
          fail();
          return;
        }
        const value: unknown = JSON.parse(event.data);
        if (!targetId) {
          const paired = PairedSchema.safeParse(value);
          if (!paired.success) {
            fail();
            return;
          }
          targetId = paired.data.targetId;
          settled = true;
          clearTimeout(timer);
          resolve(dispose);
          return;
        }
        const request = ReadRequestSchema.safeParse(value);
        if (!request.success) {
          fail();
          return;
        }
        const result =
          request.data.command.targetId === targetId
            ? reader.read(request.data.command)
            : { ok: false, error: 'target_unavailable' };
        const parsed = ReadResultSchema.safeParse(result);
        let response = JSON.stringify({
          type: 'result',
          id: request.data.id,
          result: parsed.success
            ? parsed.data
            : { ok: false, error: 'evidence_unavailable' },
        });
        if (new TextEncoder().encode(response).byteLength > MAX_BRIDGE_BYTES)
          response = JSON.stringify({
            type: 'result',
            id: request.data.id,
            result: { ok: false, error: 'limit_exceeded' },
          });
        socket.send(response);
      } catch {
        fail();
      }
    });
  });
}
