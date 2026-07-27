import { afterEach, describe, expect, it } from 'bun:test';
import { defineVessel, MessageId } from '@maelstrom-co/protocol';
import { act, cleanup, render } from '@testing-library/react';
import { assertDefined } from './__tests__/assert-defined.js';
import { createMockConnector } from './__tests__/mock-connector.js';
import { createMaelstrom } from './create-maelstrom.js';
import type { MaelstromState } from './maelstrom-state-types.js';
import { vessel } from './vessel.js';

const testVessel = defineVessel({
  id: 'widget',
  name: 'Widget',
  description: 'Test widget',
  defaultVariant: 'default',
  variants: {
    default: {
      props: { label: 'test' },
      minSize: { width: 1, height: 1 },
      actions: [],
    },
  },
});

const entry = vessel(testVessel, () => null);

afterEach(() => cleanup());

// ─── No-arg call ─────────────────────────────────────────────────────────────

describe('useMaelstrom', () => {
  describe('no-arg call', () => {
    it('returns full MaelstromState with all 6 fields', async () => {
      const m = createMaelstrom({ vessels: [entry] });
      const connector = createMockConnector();

      let state: MaelstromState | undefined;

      function App() {
        state = m.useMaelstrom();
        return null;
      }

      await act(async () => {
        render(
          <m.Provider connector={connector}>
            <App />
          </m.Provider>,
        );
      });

      expect(state).toBeDefined();
      assertDefined(state);
      expect(typeof state.processIntent).toBe('function');
      expect(state.connectionStatus).toBeDefined();
      expect(state.connectionError).toBeNull();
      expect(typeof state.isProcessing).toBe('boolean');
      expect(state.lastError).toBeNull();
      expect(typeof state.sessionId).toBe('string');
    });
  });

  // ─── Selector overload ──────────────────────────────────────────────────────

  describe('selector overload', () => {
    it('returns selected primitive value directly', async () => {
      const m = createMaelstrom({ vessels: [entry] });
      const connector = createMockConnector();

      let selected: boolean | undefined;

      function App() {
        selected = m.useMaelstrom((s) => s.isProcessing);
        return null;
      }

      await act(async () => {
        render(
          <m.Provider connector={connector}>
            <App />
          </m.Provider>,
        );
      });

      expect(typeof selected).toBe('boolean');
      expect(selected).toBe(false);
    });

    it('returns derived object from selector', async () => {
      const m = createMaelstrom({ vessels: [entry] });
      const connector = createMockConnector();

      let selected: { processing: boolean } | undefined;

      function App() {
        selected = m.useMaelstrom((s) => ({ processing: s.isProcessing }));
        return null;
      }

      await act(async () => {
        render(
          <m.Provider connector={connector}>
            <App />
          </m.Provider>,
        );
      });

      expect(selected).toBeDefined();
      assertDefined(selected);
      expect(selected.processing).toBe(false);
      expect(Object.keys(selected)).toEqual(['processing']);
    });
  });

  // ─── Re-render isolation ────────────────────────────────────────────────────

  describe('re-render isolation', () => {
    it('selector component does not re-render on unrelated state change', async () => {
      const m = createMaelstrom({ vessels: [entry] });
      const connector = createMockConnector();

      let selectorRenderCount = 0;
      let fullRenderCount = 0;

      function SelectorComp() {
        m.useMaelstrom((s) => s.isProcessing);
        selectorRenderCount++;
        return null;
      }

      function FullComp() {
        m.useMaelstrom();
        fullRenderCount++;
        return null;
      }

      await act(async () => {
        render(
          <m.Provider connector={connector}>
            <SelectorComp />
            <FullComp />
          </m.Provider>,
        );
      });

      const selectorAfterMount = selectorRenderCount;
      const fullAfterMount = fullRenderCount;

      // Disconnect triggers connectionStatus change (not isProcessing)
      await act(async () => {
        await connector.disconnect();
      });

      // Full component re-renders on any state change
      expect(fullRenderCount).toBeGreaterThan(fullAfterMount);
      // Selector component should NOT re-render — isProcessing didn't change
      expect(selectorRenderCount).toBe(selectorAfterMount);
    });

    it('selector component re-renders when selected value changes', async () => {
      const m = createMaelstrom({ vessels: [entry] });

      // Make process hang so isProcessing stays true
      let resolveProcess: (() => void) | undefined;
      const connector = createMockConnector({
        process: () =>
          new Promise((resolve) => {
            resolveProcess = () =>
              resolve({
                type: 'maelstrom_response',
                requestId: MessageId('req-1'),
                userMessage: '',
                rationale: '',
                executionPlan: [],
                layout: { type: 'grid', positions: [] },
              });
          }),
      });

      let selectorRenderCount = 0;
      let state: MaelstromState | undefined;

      function SelectorComp() {
        m.useMaelstrom((s) => s.isProcessing);
        selectorRenderCount++;
        return null;
      }

      function StateComp() {
        state = m.useMaelstrom();
        return null;
      }

      await act(async () => {
        render(
          <m.Provider connector={connector}>
            <SelectorComp />
            <StateComp />
          </m.Provider>,
        );
      });

      const renderCountAfterMount = selectorRenderCount;

      // Trigger processIntent which toggles isProcessing to true
      assertDefined(state);
      const stateForProcess = state;
      await act(async () => {
        stateForProcess.processIntent('test');
      });

      // isProcessing changed to true — selector component should re-render
      expect(selectorRenderCount).toBeGreaterThan(renderCountAfterMount);

      // Clean up
      await act(async () => {
        resolveProcess?.();
      });
    });

    it('lastError updates after a failed processIntent', async () => {
      const m = createMaelstrom({ vessels: [entry] });
      const connector = createMockConnector({
        process: () => {
          throw new Error('boom');
        },
      });

      let state: MaelstromState | undefined;

      function App() {
        state = m.useMaelstrom();
        return null;
      }

      await act(async () => {
        render(
          <m.Provider connector={connector}>
            <App />
          </m.Provider>,
        );
      });

      assertDefined(state);
      expect(state.lastError).toBeNull();

      const stateSnapshot = state;
      await act(async () => {
        await stateSnapshot.processIntent('fail');
      });

      assertDefined(state);
      expect(state.lastError).toBeInstanceOf(Error);
      assertDefined(state.lastError);
      expect(state.lastError.message).toBe('boom');
    });

    it('derived object selector does not re-render when shallow-equal', async () => {
      const m = createMaelstrom({ vessels: [entry] });
      const connector = createMockConnector();

      let renderCount = 0;

      function App() {
        m.useMaelstrom((s) => ({ processing: s.isProcessing }));
        renderCount++;
        return null;
      }

      await act(async () => {
        render(
          <m.Provider connector={connector}>
            <App />
          </m.Provider>,
        );
      });

      const renderCountAfterMount = renderCount;

      // Disconnect changes connectionStatus but not isProcessing
      // Derived object { processing: false } is shallow-equal to previous
      await act(async () => {
        await connector.disconnect();
      });

      // Should NOT re-render — derived object is shallow-equal
      expect(renderCount).toBe(renderCountAfterMount);
    });
  });
});
