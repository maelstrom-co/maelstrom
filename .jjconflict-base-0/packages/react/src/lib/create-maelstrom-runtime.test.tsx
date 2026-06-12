import { describe, it, expect, afterEach } from 'bun:test';
import { render, cleanup, act } from '@testing-library/react';

import { createMaelstrom } from './create-maelstrom.js';
import { vessel } from './vessel.js';
import { testVessel } from './__tests__/test-vessel.fixture.js';
import { createMockConnector } from './__tests__/mock-connector.js';

const entry = vessel(testVessel, () => null);

afterEach(() => cleanup());

describe('m.Provider', () => {
  it('renders children', async () => {
    const connector = createMockConnector();
    const m = createMaelstrom({ vessels: [entry] });

    let container: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <m.Provider connector={connector}>
          <div>hello</div>
        </m.Provider>,
      ));
    });

    expect(container!.innerHTML).toContain('hello');
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
    expect(result!.isProcessing).toBe(false);
    expect(result!.lastError).toBeNull();
    expect(result!.connectionError).toBeNull();
    expect(typeof result!.processIntent).toBe('function');
    expect(typeof result!.sessionId).toBe('string');
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
    await act(async () => {
      await state!.processIntent('test');
    });

    expect(state!.lastError).toBeInstanceOf(Error);
    expect(state!.lastError!.message).toContain('engine down');
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
    await act(async () => {
      await state!.processIntent('fail');
    });
    expect(state!.lastError).toBeInstanceOf(Error);

    // Second call succeeds — lastError should clear
    await act(async () => {
      await state!.processIntent('succeed');
    });
    expect(state!.lastError).toBeNull();
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

    await act(async () => {
      await state!.processIntent('test');
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('kaboom');
  });

});
