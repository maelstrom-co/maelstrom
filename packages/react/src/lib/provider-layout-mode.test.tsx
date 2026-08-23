import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as realClient from '@maelstrom-co/client';
import { DEFAULT_LAYOUT_MODE } from '@maelstrom-co/client';
import type { LayoutMode } from '@maelstrom-co/protocol';
import { act, cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMockConnector } from './__tests__/mock-connector.js';
import { createMaelstromContext } from './context.js';
import { createProvider } from './provider.js';

// A controllable fake standing in for the real Orchestrator so this test can
// observe every setLayoutMode call and read back the effective mode without
// depending on a live connection. Mirrors
// provider-construction-failure.test.tsx's approach.
class FakeOrchestrator {
  // Counts constructions across the whole file so a test can assert the
  // Provider built exactly one Orchestrator per mount. Reset in beforeEach.
  static constructions = 0;
  readonly setLayoutModeCalls: LayoutMode[] = [];
  #layoutMode: LayoutMode;
  readonly vesselManager = { registerVessel: () => {} };
  // The Provider subscribes to processing_error here to route a refused
  // command to onError; only the subscription surface matters to this test.
  readonly commandProcessor = {
    events: { on: () => () => {} },
  };

  constructor(
    public readonly connector: unknown,
    public readonly options: { layoutMode?: LayoutMode },
  ) {
    FakeOrchestrator.constructions += 1;
    this.#layoutMode = options.layoutMode ?? DEFAULT_LAYOUT_MODE;
  }

  connect(): Promise<void> {
    return Promise.resolve();
  }

  setConnector(): void {
    // no-op — irrelevant to this test.
  }

  setLayoutMode(mode: LayoutMode): void {
    this.#layoutMode = mode;
    this.setLayoutModeCalls.push(mode);
  }

  getConfig(): { layoutMode: LayoutMode } {
    return { layoutMode: this.#layoutMode };
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}

const RealOrchestrator = realClient.Orchestrator;

beforeEach(() => {
  FakeOrchestrator.constructions = 0;
});

describe('Provider layoutMode prop (fix: clearing the prop must reset the live Orchestrator to the default, not freeze it on the last explicit mode)', () => {
  it('pushes the default back into the Orchestrator when a previously-set layoutMode prop is omitted', async () => {
    mock.module('@maelstrom-co/client', () => ({
      ...realClient,
      Orchestrator: FakeOrchestrator,
    }));

    try {
      const contextPair = createMaelstromContext();
      const Provider = createProvider(contextPair, [], {});
      const connector = createMockConnector();

      let rerender!: (ui: ReactElement) => void;
      await act(async () => {
        ({ rerender } = render(
          <Provider connector={connector} layoutMode="grid">
            <div />
          </Provider>,
        ));
      });

      const instance = contextPair.contextRef.current
        ?.orchestrator as unknown as FakeOrchestrator;
      expect(instance).toBeInstanceOf(FakeOrchestrator);
      expect(instance.getConfig().layoutMode).toBe('grid');

      // A settings toggle turning the override off: the prop goes from an
      // explicit 'grid' back to omitted. Every request after this must carry
      // the default mode again, not the 'grid' the app believes it left
      // behind. (setLayoutMode also fires once at mount, re-asserting
      // 'grid' — harmless, same as the sibling setConnector effect — so this
      // checks the most recent call and the resulting state rather than the
      // full call history.)
      await act(async () => {
        rerender(
          <Provider connector={connector}>
            <div />
          </Provider>,
        );
      });

      expect(instance.setLayoutModeCalls.at(-1)).toBe(DEFAULT_LAYOUT_MODE);
      expect(instance.getConfig().layoutMode).toBe(DEFAULT_LAYOUT_MODE);
    } finally {
      mock.module('@maelstrom-co/client', () => ({
        ...realClient,
        Orchestrator: RealOrchestrator,
      }));
      cleanup();
    }
  });

  it('leaves the effective mode at the default when the prop is absent, including across an unrelated re-render', async () => {
    mock.module('@maelstrom-co/client', () => ({
      ...realClient,
      Orchestrator: FakeOrchestrator,
    }));

    try {
      const contextPair = createMaelstromContext();
      const Provider = createProvider(contextPair, [], {});
      const connector = createMockConnector();

      let rerender!: (ui: ReactElement) => void;
      await act(async () => {
        ({ rerender } = render(
          <Provider connector={connector}>
            <div />
          </Provider>,
        ));
      });

      const instance = contextPair.contextRef.current
        ?.orchestrator as unknown as FakeOrchestrator;
      expect(instance).toBeInstanceOf(FakeOrchestrator);
      expect(instance.getConfig().layoutMode).toBe(DEFAULT_LAYOUT_MODE);

      // An unrelated re-render (a `debug` toggle here, standing in for any
      // prop that isn't layoutMode) must not disturb the mode — it should
      // still read as the default afterward, not drift to something else.
      await act(async () => {
        rerender(
          <Provider connector={connector} debug>
            <div />
          </Provider>,
        );
      });

      expect(instance.getConfig().layoutMode).toBe(DEFAULT_LAYOUT_MODE);
    } finally {
      mock.module('@maelstrom-co/client', () => ({
        ...realClient,
        Orchestrator: RealOrchestrator,
      }));
      cleanup();
    }
  });
});

describe('Provider Orchestrator construction (fix: a prop change must not throw away the session)', () => {
  it('constructs the Orchestrator exactly once per mount across debug, layoutMode and connector changes', async () => {
    mock.module('@maelstrom-co/client', () => ({
      ...realClient,
      Orchestrator: FakeOrchestrator,
    }));

    try {
      const contextPair = createMaelstromContext();
      const Provider = createProvider(contextPair, [], {});
      const connector = createMockConnector();
      const currentInstance = () =>
        contextPair.contextRef.current
          ?.orchestrator as unknown as FakeOrchestrator;

      let rerender!: (ui: ReactElement) => void;
      await act(async () => {
        ({ rerender } = render(
          <Provider connector={connector}>
            <div />
          </Provider>,
        ));
      });

      const instance = currentInstance();
      expect(instance).toBeInstanceOf(FakeOrchestrator);
      expect(FakeOrchestrator.constructions).toBe(1);

      // `debug` is the motivating bug: it only gates logging, yet flipping it
      // used to rebuild the Orchestrator — "toggling a logging flag threw away
      // the session". Counting constructions is what pins that down; asserting
      // on a *captured* instance can't, since a stale instance keeps answering
      // as if nothing happened.
      await act(async () => {
        rerender(
          <Provider connector={connector} debug>
            <div />
          </Provider>,
        );
      });

      expect(FakeOrchestrator.constructions).toBe(1);
      expect(currentInstance()).toBe(instance);

      // layoutMode is pushed into the live instance by setLayoutMode.
      await act(async () => {
        rerender(
          <Provider connector={connector} debug layoutMode="grid">
            <div />
          </Provider>,
        );
      });

      expect(FakeOrchestrator.constructions).toBe(1);
      expect(currentInstance()).toBe(instance);

      // A fresh connector identity is the re-auth case: swapped in via
      // setConnector, never by rebuilding.
      await act(async () => {
        rerender(
          <Provider connector={createMockConnector()} debug layoutMode="grid">
            <div />
          </Provider>,
        );
      });

      expect(FakeOrchestrator.constructions).toBe(1);
      expect(currentInstance()).toBe(instance);
    } finally {
      mock.module('@maelstrom-co/client', () => ({
        ...realClient,
        Orchestrator: RealOrchestrator,
      }));
      cleanup();
    }
  });
});
