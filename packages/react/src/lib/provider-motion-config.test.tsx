import { afterEach, describe, expect, it } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';

import { createMaelstromContext } from './context.js';
import { createProvider } from './provider.js';
import { createMockConnector } from './__tests__/mock-connector.js';
import { testVessel } from './__tests__/test-vessel.fixture.js';
import { vessel } from './vessel.js';
import { DEFAULT_MOTION } from './chart/motion/motion-config.js';
import type { ConfigOverrides } from './config-types.js';

const entry = vessel(testVessel, () => null);

afterEach(() => cleanup());

/**
 * Renders a bare Provider (bypassing createMaelstrom) so the test can read
 * the resolved config straight off the context — createMaelstrom() does not
 * expose its internal contextPair to consumers.
 */
async function renderAndCaptureConfig(
  factoryConfig: ConfigOverrides,
  providerProps: Record<string, unknown>,
) {
  const contextPair = createMaelstromContext();
  const Provider = createProvider(contextPair, [entry], factoryConfig);
  const connector = createMockConnector();

  function Probe() {
    contextPair.useMaelstromContext();
    return null;
  }

  await act(async () => {
    render(
      <Provider connector={connector} {...providerProps}>
        <Probe />
      </Provider>,
    );
  });

  return contextPair.contextRef.current?.config;
}

describe('motion config resolution (Addendum 2b)', () => {
  it('Provider motion prop overrides individual fields, defaults fill the rest', async () => {
    const config = await renderAndCaptureConfig({}, { motion: { durationMs: 200 } });

    expect(config?.motion.durationMs).toBe(200);
    expect(config?.motion.easing).toBe(DEFAULT_MOTION.easing);
    expect(config?.motion.staggerMs).toBe(DEFAULT_MOTION.staggerMs);
    expect(config?.motion.disabled).toBe(DEFAULT_MOTION.disabled);
  });

  it('Provider motion prop takes precedence over factory (createMaelstrom) motion config', async () => {
    // The factory config gets a second distinguishing field (`easing:
    // 'linear'`, which differs from DEFAULT_MOTION.easing) so this test can
    // tell whole-object replacement apart from a per-field merge: if the
    // Provider's `motion` were merged field-by-field onto the factory's, the
    // resolved easing would be the factory's 'linear' (the Provider didn't
    // specify one). Because `provider.motion ?? factory.motion` replaces the
    // whole object once the Provider sets ANY motion field, the factory is
    // never consulted and easing falls back to DEFAULT_MOTION instead.
    const config = await renderAndCaptureConfig(
      { motion: { ...DEFAULT_MOTION, durationMs: 100, easing: 'linear' } },
      { motion: { durationMs: 200 } },
    );

    expect(config?.motion.durationMs).toBe(200);
    expect(config?.motion.easing).toBe(DEFAULT_MOTION.easing);
  });

  it('falls back to factory motion config when Provider does not override', async () => {
    const config = await renderAndCaptureConfig(
      { motion: { ...DEFAULT_MOTION, durationMs: 100 } },
      {},
    );

    expect(config?.motion.durationMs).toBe(100);
  });
});
