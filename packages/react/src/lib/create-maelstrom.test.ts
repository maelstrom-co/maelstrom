import { afterEach, describe, expect, it } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { createElement } from 'react';

import { defineVessel } from '@maelstrom-co/protocol';

import { createMaelstrom } from './create-maelstrom.js';
import { vessel } from './vessel.js';
import { testVessel } from './__tests__/test-vessel.fixture.js';
import { createMockConnector } from './__tests__/mock-connector.js';
import type { MaelstromExtensionContext } from './extension-types.js';
import type { MaelstromProviderProps } from './provider.js';

afterEach(() => cleanup());

describe('createMaelstrom', () => {
  it('accepts entries with literal IDs', () => {
    const entry = vessel(testVessel, () => null);
    const instance = createMaelstrom({ vessels: [entry] });
    void instance;
  });

  it('forwards the factory `motion` config through to a consumer inside the Provider', async () => {
    // createMaelstrom() doesn't expose its internal contextPair to
    // consumers (see provider-motion-config.test.tsx), so this reads the
    // resolved config through the same public seam an extension author
    // would use (`with()` + `useMaelstromContext()`), proving the `motion`
    // passed to createMaelstrom actually reaches a Provider-tree consumer.
    const entry = vessel(testVessel, () => null);
    const m = createMaelstrom({ vessels: [entry], motion: { durationMs: 4242 } }).with(
      (ctx: MaelstromExtensionContext) => ({
        useConfig: () => ctx.useMaelstromContext().config,
      }),
    );
    const connector = createMockConnector();

    let capturedDurationMs: number | undefined;
    function Reader() {
      capturedDurationMs = m.useConfig().motion.durationMs;
      return null;
    }

    await act(async () => {
      render(
        // `children` is passed as a createElement rest arg, not the props
        // object, so it's omitted here -- MaelstromProviderProps declares it
        // required, hence the cast.
        createElement(m.Provider, { connector } as MaelstromProviderProps, createElement(Reader)),
      );
    });

    expect(capturedDurationMs).toBe(4242);
  });

  it('rejects entries with widened id: string', () => {
    const widenedVessel = defineVessel({
      id: 'orders' as string,
      name: 'Orders',
      description: 'Order management vessel',
      defaultVariant: 'list',
      variants: {
        list: {
          props: {},
          minSize: { width: 1, height: 1 },
          actions: [],
        },
      },
    });
    const entry = vessel(widenedVessel, () => null);
    // @ts-expect-error - widened string ID should be rejected
    const _instance = createMaelstrom({ vessels: [entry] });
    void _instance;
  });
});
