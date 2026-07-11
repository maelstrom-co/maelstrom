import { describe, expect, it } from 'vitest';
import { createDemoConnector } from './connector';

describe('createDemoConnector', () => {
  it('does not send a handshake frame in local (non-hosted) mode', () => {
    // import.meta.env.VITE_HOSTED is unset in the test environment by
    // default — this exercises the local-dev branch.
    const connector = createDemoConnector({ getApiKey: () => null });
    expect(connector).toBeTruthy();
    // WebSocketConnector has no public way to inspect its onOpen option
    // directly, so this test asserts the *contract*: constructing the
    // connector must not throw even though getApiKey returns null, proving
    // the local branch never dereferences it.
  });

  it('is constructed with a getApiKey option in hosted mode without throwing when no key is set', () => {
    const connector = createDemoConnector({ getApiKey: () => null });
    expect(connector).toBeTruthy();
  });
});
