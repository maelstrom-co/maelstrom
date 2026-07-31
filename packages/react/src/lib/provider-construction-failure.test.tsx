import { describe, expect, it, mock } from 'bun:test';
import * as realClient from '@maelstrom-co/client';
import { act, cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMockConnector } from './__tests__/mock-connector.js';
import { createMaelstromContext } from './context.js';
import { createProvider } from './provider.js';

// A controllable fake standing in for the real Orchestrator so this test can
// force a construction failure on a *specific* attempt, independent of why
// the real Orchestrator might throw (initialLayout validation today, maybe
// something else tomorrow). What's under test is the Provider's own
// error-handling contract — a construction failure must never leave a
// disposed-or-stale instance looking current in context — not any one
// specific validation rule inside Orchestrator itself.
class FakeOrchestrator {
  static disposeCalls = 0;
  static shouldFailNextConstruction = false;
  #disposed = false;

  constructor(
    public readonly connector: unknown,
    public readonly options: unknown,
  ) {
    if (FakeOrchestrator.shouldFailNextConstruction) {
      FakeOrchestrator.shouldFailNextConstruction = false;
      throw new Error('synthetic construction failure');
    }
  }

  connect(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    this.#disposed = true;
    FakeOrchestrator.disposeCalls += 1;
    return Promise.resolve();
  }

  get isDisposed(): boolean {
    return this.#disposed;
  }
}

// Snapshotted *before* any mocking — `realClient` is a live ESM namespace
// binding, so reading `realClient.Orchestrator` lazily inside the restore
// factory below (after mock.module has patched the registry) would just
// read back the mock, making "restoration" a no-op. Capturing the class
// reference itself, up front, is what actually restores it.
const RealOrchestrator = realClient.Orchestrator;

describe('Provider construction-failure recovery (fix: disposed orchestrator must not linger in context)', () => {
  it('clears a disposed orchestrator from context when an effect re-run fails to construct a replacement', async () => {
    // `mock.module` patches '@maelstrom-co/client' process-wide — every other
    // test file in this package's `bun test` run shares that registry. Both
    // the mock and its restoration are scoped tightly around this one test's
    // render calls (nothing else runs in between, since test bodies execute
    // sequentially) so no other file ever observes the fake.
    mock.module('@maelstrom-co/client', () => ({
      ...realClient,
      Orchestrator: FakeOrchestrator,
    }));

    try {
      const contextPair = createMaelstromContext();
      const Provider = createProvider(contextPair, [], {});

      function App() {
        return <div>alive</div>;
      }

      FakeOrchestrator.shouldFailNextConstruction = false;
      FakeOrchestrator.disposeCalls = 0;

      let rerender!: (ui: ReactElement) => void;
      let container!: HTMLElement;
      await act(async () => {
        ({ rerender, container } = render(
          <Provider connector={createMockConnector()}>
            <App />
          </Provider>,
        ));
      });

      // First mount succeeded: children render, and context holds the live
      // instance.
      expect(container.innerHTML).toContain('alive');
      const firstInstance = contextPair.contextRef.current
        ?.orchestrator as unknown as FakeOrchestrator;
      expect(firstInstance).toBeInstanceOf(FakeOrchestrator);

      // A new `connector` reference rebuilds the Orchestrator (connector is
      // a watched dep): cleanup disposes the first instance, then the
      // second construction attempt fails.
      FakeOrchestrator.shouldFailNextConstruction = true;
      await act(async () => {
        rerender(
          <Provider connector={createMockConnector()}>
            <App />
          </Provider>,
        );
      });

      // The first instance really was disposed by the rebuild's cleanup —
      // this is the "stale, disposed instance" the bug used to leave
      // behind.
      expect(FakeOrchestrator.disposeCalls).toBe(1);
      expect(firstInstance.isDisposed).toBe(true);

      // Without the fix, `orchestrator` state still held that disposed
      // first instance (setOrchestrator was never called for the failed
      // second attempt), so context and children kept rendering as if
      // nothing had happened — every click on them silently dead. The fix
      // clears it: context is null and children collapse instead of
      // serving a corpse.
      expect(contextPair.contextRef.current).toBeNull();
      expect(container.innerHTML).not.toContain('alive');
    } finally {
      mock.module('@maelstrom-co/client', () => ({
        ...realClient,
        Orchestrator: RealOrchestrator,
      }));
      cleanup();
    }
  });
});
