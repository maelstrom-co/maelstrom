# Attach detection to an application-owned stream

Validate detector configuration before creating it. Pass the current
connection-bound stream and transport callbacks; this package does not acquire
the microphone or own the provider transport.

```ts
import { createBrowserVad, type CreateBrowserVadOptions, resolveBrowserVadConfig } from '@maelstrom-co/realtime-vad';

export async function attachDetector(
  stream: MediaStream,
  policy: unknown,
  callbacks: Pick<CreateBrowserVadOptions, 'startTurn' | 'endTurn' | 'cancelTurn' | 'onFailure'>,
) {
  const config = resolveBrowserVadConfig(policy);
  if (!config.enabled) return undefined;
  return createBrowserVad({ stream, config, ...callbacks });
}
```

Supply every lifecycle callback, including cancellation for short speech
misfires. Serve assets from trusted application configuration. The Node asset
copier belongs to the `assets` subpath, not a browser bundle.

## Verify

Test initialization failure, short speech cancellation, duplicate edges,
mid-session failure, and teardown without stopping the shared microphone stream.
Use the detector's injected loader seam for deterministic tests, then test real
microphone/audio/worklet behavior separately.

## Troubleshoot

`false` selects manual policy without detector resources. Asset validation and
callback failures require adapter-owned safe degradation. Retire the old
generation before exposing manual controls; if transport audio cannot be stopped
safely, fail the session instead of claiming successful degradation.
