# Construct the server-only minter

The configuration comes from trusted server settings, never browser input.
This fragment constructs a helper; it is not a production HTTP route.

```ts
import { createOpenAIMinter } from '@maelstrom-co/realtime-openai-server';

export function configureMinter(apiKey: string, allowedModel: string) {
  return createOpenAIMinter({ apiKey, model: allowedModel });
}
```

Before invoking it for a browser, authenticate and authorize the caller. Enforce
trusted origin, CSRF where relevant, fail-closed throttling, model policy, and
private/no-store responses. Request model overrides can replace the configured
default, so validate them against server policy. The minter does not implement
these application controls.

## Verify

Inject the installed `fetch` seam to test malformed input, upstream failure,
redirect rejection, and invalid provider responses without real credentials.
Assert that only a scoped short-lived Grant reaches the browser.

## Troubleshoot

Handle the returned Result instead of assuming a thrown error. Use the installed
mint-failure taxonomy for bounded response copy. Missing server credentials and
invalid configuration are host failures, not reasons to request keys from users
or place them in browser code. A local fake-fetch test is not live mint success.
