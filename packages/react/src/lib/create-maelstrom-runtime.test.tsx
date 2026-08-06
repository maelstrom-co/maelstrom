import { afterEach, describe, expect, it } from 'bun:test';
import {
  InstanceId,
  type MaelstromResponse,
  MessageId,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import { act, cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { assertDefined } from './__tests__/assert-defined.js';
import { createMockConnector } from './__tests__/mock-connector.js';
import { testVessel } from './__tests__/test-vessel.fixture.js';
import { createMaelstrom } from './create-maelstrom.js';
import { vessel } from './vessel.js';

const entry = vessel(testVessel, () => null);

afterEach(() => cleanup());

describe('m.Provider', () => {
  it('renders children', async () => {
    const connector = createMockConnector();
    const m = createMaelstrom({ vessels: [entry] });

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <m.Provider connector={connector}>
          <div>hello</div>
        </m.Provider>,
      ));
    });

    expect(container.innerHTML).toContain('hello');
  });

  it('throws when useMaelstrom is called outside Provider', () => {
    const m = createMaelstrom({ vessels: [entry] });

    function Boom() {
      m.useMaelstrom();
      return null;
    }

    expect(() => render(<Boom />)).toThrow(
      'useMaelstrom() must be used within a <Provider>',
    );
  });

  it('each createMaelstrom call creates isolated context', () => {
    const m1 = createMaelstrom({ vessels: [entry] });
    const m2 = createMaelstrom({ vessels: [entry] });

    // Using m1.useMaelstrom inside m2.Provider should throw
    function CrossWired() {
      m1.useMaelstrom();
      return null;
    }

    expect(() =>
      render(
        <m2.Provider connector={createMockConnector()}>
          <CrossWired />
        </m2.Provider>,
      ),
    ).toThrow('useMaelstrom() must be used within a <Provider>');
  });
});

describe('Orchestrator identity', () => {
  it('preserves the board when the connector is swapped', async () => {
    const entry = vessel(testVessel, () => null);
    const m = createMaelstrom({ vessels: [entry] });

    const seededResponse: MaelstromResponse = {
      type: 'maelstrom_response',
      requestId: MessageId('req-seed'),
      userMessage: '',
      rationale: '',
      executionPlan: [],
      layout: {
        type: 'tiling',
        tree: [InstanceId('seed-1')],
        instances: [
          {
            instanceId: InstanceId('seed-1'),
            vesselId: VesselId(testVessel.id),
            variant: VariantName(testVessel.defaultVariant),
          },
        ],
      },
    };
    let firstConnectorCalls = 0;
    let secondConnectorCalls = 0;
    const firstConnector = createMockConnector({
      process: async () => {
        firstConnectorCalls++;
        return seededResponse;
      },
    });
    // Re-seeds the same board so the swap itself stays observable through the
    // call counters rather than through the board being torn down.
    const secondConnector = createMockConnector({
      process: async (message) => {
        secondConnectorCalls++;
        return { ...seededResponse, requestId: message.id };
      },
    });

    let props: { instanceId: string } | null | undefined;
    let processIntent!: (intent: string) => Promise<void>;
    function App() {
      props = m.useInstance('seed-1');
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    let rerender!: (ui: ReactElement) => void;
    await act(async () => {
      ({ rerender } = render(
        <m.Provider connector={firstConnector}>
          <App />
        </m.Provider>,
      ));
    });

    // Seed the board through a normal engine round trip — there is no
    // initialLayout prop yet, that lands in a later PR.
    await act(async () => {
      await processIntent('seed the board');
    });
    expect(props?.instanceId).toBe('seed-1');

    // A connector swap is a transport change, not a session change — re-auth
    // is the real case. Before this refactor it tore the Orchestrator down
    // (a fresh instance with an empty CommandProcessor store), so the seeded
    // board vanished. The board must simply survive.
    await act(async () => {
      rerender(
        <m.Provider connector={secondConnector}>
          <App />
        </m.Provider>,
      );
    });

    expect(props?.instanceId).toBe('seed-1');

    // Surviving the rerender follows from the construction effect's deps
    // alone; it says nothing about which transport the Orchestrator is still
    // holding. Issuing a request after the swap is what proves the new
    // connector actually took over — the re-auth case fails closed otherwise,
    // with the Provider quietly talking to a revoked connector.
    const firstCallsBeforeSwap = firstConnectorCalls;
    await act(async () => {
      await processIntent('after swap');
    });

    expect(secondConnectorCalls).toBe(1);
    expect(firstConnectorCalls).toBe(firstCallsBeforeSwap);
  });

  it('rebuilds the Orchestrator when the session changes', async () => {
    const entry = vessel(testVessel, () => null);
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector();

    const seen: unknown[] = [];
    function App() {
      seen.push(m.useMaelstrom().sessionId);
      return null;
    }

    let rerender!: (ui: ReactElement) => void;
    await act(async () => {
      ({ rerender } = render(
        <m.Provider key="session-a" connector={connector} sessionId="session-a">
          <App />
        </m.Provider>,
      ));
    });

    // sessionId is captured once per mount (see the "captured once on
    // mount" warning in provider.tsx), so switching sessions is done by
    // remounting the Provider under a new key — the documented, supported
    // way an app changes sessions. sessionId is the one dep that still
    // justifies a teardown: a new session starts empty by definition.
    await act(async () => {
      rerender(
        <m.Provider key="session-b" connector={connector} sessionId="session-b">
          <App />
        </m.Provider>,
      );
    });

    expect(seen).toContain('session-b');
  });
});

describe('m.useMaelstrom()', () => {
  it('returns initial state', async () => {
    const connector = createMockConnector();
    const m = createMaelstrom({ vessels: [entry] });

    let result: ReturnType<typeof m.useMaelstrom> | undefined;
    function Reader() {
      result = m.useMaelstrom();
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Reader />
        </m.Provider>,
      );
    });

    expect(result).toBeDefined();
    assertDefined(result);
    expect(result.isProcessing).toBe(false);
    expect(result.lastError).toBeNull();
    expect(result.connectionError).toBeNull();
    expect(typeof result.processIntent).toBe('function');
    expect(typeof result.sessionId).toBe('string');
  });

  it('processIntent does not reject on error', async () => {
    const connector = createMockConnector({
      process: async () => {
        throw new Error('engine down');
      },
    });
    const m = createMaelstrom({ vessels: [entry] });

    let state: ReturnType<typeof m.useMaelstrom> | undefined;
    function Reader() {
      state = m.useMaelstrom();
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Reader />
        </m.Provider>,
      );
    });

    // processIntent should not throw
    assertDefined(state);
    const stateAfterMount = state;
    await act(async () => {
      await stateAfterMount.processIntent('test');
    });

    assertDefined(state);
    expect(state.lastError).toBeInstanceOf(Error);
    assertDefined(state.lastError);
    expect(state.lastError.message).toContain('engine down');
  });

  it('lastError auto-clears on next processIntent call', async () => {
    let callCount = 0;
    const connector = createMockConnector({
      process: async (message) => {
        callCount++;
        if (callCount === 1) throw new Error('first call fails');
        return {
          type: 'maelstrom_response' as const,
          requestId: message.id,
          userMessage: '',
          rationale: '',
          executionPlan: [],
          layout: { type: 'grid' as const, positions: [] },
        };
      },
    });
    const m = createMaelstrom({ vessels: [entry] });

    let state: ReturnType<typeof m.useMaelstrom> | undefined;
    function Reader() {
      state = m.useMaelstrom();
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <Reader />
        </m.Provider>,
      );
    });

    // First call fails
    assertDefined(state);
    const stateBeforeFail = state;
    await act(async () => {
      await stateBeforeFail.processIntent('fail');
    });
    assertDefined(state);
    expect(state.lastError).toBeInstanceOf(Error);

    // Second call succeeds — lastError should clear
    assertDefined(state);
    const stateBeforeSucceed = state;
    await act(async () => {
      await stateBeforeSucceed.processIntent('succeed');
    });
    assertDefined(state);
    expect(state.lastError).toBeNull();
  });

  it('onError callback fires on processIntent failure', async () => {
    const errors: Error[] = [];
    const connector = createMockConnector({
      process: async () => {
        throw new Error('kaboom');
      },
    });
    const m = createMaelstrom({ vessels: [entry] });

    let state: ReturnType<typeof m.useMaelstrom> | undefined;
    function Reader() {
      state = m.useMaelstrom();
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector} onError={(e) => errors.push(e)}>
          <Reader />
        </m.Provider>,
      );
    });

    assertDefined(state);
    const stateAfterMount = state;
    await act(async () => {
      await stateAfterMount.processIntent('test');
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('kaboom');
  });
});
