import { isErr } from '@maelstrom-co/protocol';
import { mintLiveKitToken } from '@maelstrom-co/realtime-livekit-server';
import { createServerFn } from '@tanstack/react-start';

/**
 * TanStack Start server fn wrapping the framework-free `mintLiveKitToken` from
 * `@maelstrom-co/realtime-livekit-server`. This thin wrapper is all the demo
 * owns — request validation and the token-grant logic live in the package, so
 * the raw request is passed straight through. Injected into the
 * `LiveKitAdapter` as `mintToken` so the browser bundle never imports
 * `livekit-server-sdk`. A mint failure is surfaced as a throw, which the
 * adapter wraps as a `TOKEN_MINT_FAILED` voice error.
 */
export const getLivekitToken = createServerFn({ method: 'GET' })
  .validator((data: unknown) => data)
  .handler(async ({ data }) => {
    const result = await mintLiveKitToken(data);
    if (isErr(result)) {
      throw new Error(`LiveKit token mint failed: ${result.error.reason}`);
    }
    return result.value;
  });
