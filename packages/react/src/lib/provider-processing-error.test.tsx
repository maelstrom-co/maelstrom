import { afterEach, describe, expect, it } from 'bun:test';
import {
  ActionName,
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
// `processing_error` event. setLayout returns void, and store.state.lastError
// is cleared by the next command; waitForIdle now surfaces the refusal too,
// but only to direct callers of the client package — the Provider doesn't
// consume its Result. This pins that the Provider forwards the event to the
// app's onError, so the "loud failure" the duplicate-tile merge was deleted
// in favour of has a real listener.
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
    const onScreen = commandProcessor.store.state.layout;
    if (onScreen?.type !== 'tiling')
      throw new Error('expected a tiling layout');
    expect(onScreen.tree).toEqual([
      'V',
      InstanceId('orders-main'),
      InstanceId('orders-side'),
    ]);
  });
});

// `processing_error` names the command that threw; `batch_abandoned` names the
// trailing commands of its atomic batch that never ran. Only the first has a
// store trace, so without this forwarding the second half of the damage is
// visible to an app only as an internal logger line.
describe('Provider batch_abandoned forwarding', () => {
  it('reports the commands a refused set_layout abandoned', async () => {
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
      commandProcessor.dispatch(
        {
          kind: 'set_layout',
          layout: layoutOf([
            'V',
            InstanceId('orders-main'),
            InstanceId('orders-main'),
          ]),
        },
        {
          kind: 'execute_actions',
          executionPlan: [
            {
              instanceId: InstanceId('orders-main'),
              action: ActionName('refresh'),
            },
          ],
        },
      );
      await commandProcessor.waitForIdle();
    });

    // Both halves reach onError for the one root failure: the refusal, then
    // the abandonment it caused.
    expect(errors).toHaveLength(2);
    expect(errors[0].message).toMatch(/"orders-main" more than once/);
    expect(errors[1].message).toContain('"set_layout" failed');
    expect(errors[1].message).toContain('execute_actions');
  });
});
