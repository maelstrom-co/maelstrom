import { afterEach, describe, expect, it } from 'bun:test';
import {
  InstanceId,
  isInstanceIdNode,
  type TilingLayout,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import { act, cleanup, render } from '@testing-library/react';
import { createMockConnector } from './__tests__/mock-connector.js';
import { testVessel } from './__tests__/test-vessel.fixture.js';
import { createMaelstromContext } from './context.js';
import { createProvider } from './provider.js';
import { vessel } from './vessel.js';

const entry = vessel(testVessel, () => null);

function layoutOf(tree: TilingLayout['tree']): TilingLayout {
  const leaves = new Set(tree.filter(isInstanceIdNode));
  return {
    type: 'tiling',
    tree,
    instances: [...leaves].map((instanceId) => ({
      instanceId,
      vesselId: VesselId('orders'),
      variant: VariantName('list'),
    })),
  };
}

afterEach(() => cleanup());

// The gate throws inside #processCommand, which converts it into a
// `processing_error` event. Nothing else in the app can see the refusal:
// setLayout returns void, waitForIdle resolves the same either way, and
// store.state.lastError is cleared by the next command. This pins that the
// Provider forwards the event to the app's onError, so the "loud failure"
// the duplicate-tile merge was deleted in favour of has a real listener.
describe('Provider processing_error forwarding', () => {
  it('routes a refused set_layout to onError', async () => {
    const contextPair = createMaelstromContext();
    const Provider = createProvider(contextPair, [entry], {});
    const connector = createMockConnector();
    const errors: Error[] = [];

    await act(async () => {
      render(
        <Provider
          connector={connector}
          initialLayout={layoutOf([
            'V',
            InstanceId('orders-main'),
            InstanceId('orders-side'),
          ])}
          onError={(error) => errors.push(error)}
        >
          <div />
        </Provider>,
      );
    });

    const commandProcessor =
      contextPair.contextRef.current?.orchestrator.commandProcessor;
    if (!commandProcessor) throw new Error('expected an Orchestrator');

    await act(async () => {
      commandProcessor.setLayout(
        layoutOf(['V', InstanceId('orders-main'), InstanceId('orders-main')]),
      );
      await commandProcessor.waitForIdle();
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/"orders-main" more than once/);
    // The refusal is the whole failure mode: the seed stays on screen.
    expect(commandProcessor.store.state.layout?.tree).toEqual([
      'V',
      InstanceId('orders-main'),
      InstanceId('orders-side'),
    ]);
  });
});
