import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import type { EngineConnector } from '@maelstrom-co/client';
import {
  InstanceId,
  type TilingLayout,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import { act, cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { createMockConnector } from './__tests__/mock-connector.js';
import { testVessel } from './__tests__/test-vessel.fixture.js';
import { createMaelstromContext } from './context.js';
import { createProvider } from './provider.js';
import { vessel } from './vessel.js';

const entry = vessel(testVessel, () => null);

const seedLayout: TilingLayout = freshSeedLayout();

// Same instance, a different declared variant — a genuinely different seed
// that still resolves against the registered test vessel.
const detailSeedLayout: TilingLayout = {
  type: 'tiling',
  tree: [InstanceId('orders-main')],
  instances: [
    {
      instanceId: InstanceId('orders-main'),
      vesselId: VesselId('orders'),
      variant: VariantName('detail'),
    },
  ],
};

const secondarySeedLayout: TilingLayout = {
  type: 'tiling',
  tree: [InstanceId('orders-secondary')],
  instances: [
    {
      instanceId: InstanceId('orders-secondary'),
      vesselId: VesselId('orders'),
      variant: VariantName('list'),
    },
  ],
};

afterEach(() => cleanup());

describe('Provider initialLayout', () => {
  it('seeds the instance before any engine round-trip', async () => {
    const contextPair = createMaelstromContext();
    const Provider = createProvider(contextPair, [entry], {});
    const connector = createMockConnector();

    await act(async () => {
      render(
        <Provider connector={connector} initialLayout={seedLayout}>
          <div />
        </Provider>,
      );
    });

    const orchestrator = contextPair.contextRef.current?.orchestrator;
    const seeded = orchestrator?.commandProcessor.store.state.instances.get(
      InstanceId('orders-main'),
    );
    expect(seeded?.vesselId).toBe(VesselId('orders'));
    expect(seeded?.variant).toBe(VariantName('list'));
  });

  // The construction effect depends on `[stableSessionId]` alone and reads
  // `initialLayout` straight from its closure, so both StrictMode
  // double-invoke passes build from the same closure and seed the same way —
  // there is no seeding ref for the first, discarded pass to burn.
  it('still seeds the surviving Orchestrator when StrictMode double-invokes the mount effect', async () => {
    const contextPair = createMaelstromContext();
    const Provider = createProvider(contextPair, [entry], {});
    // Counted so the test fails rather than silently degrading into a
    // duplicate of the one above if the double-invoke ever stops firing.
    let connects = 0;
    const connector: EngineConnector = {
      ...createMockConnector(),
      connect: async () => {
        connects += 1;
      },
    };

    await act(async () => {
      render(
        <StrictMode>
          <Provider connector={connector} initialLayout={seedLayout}>
            <div />
          </Provider>
        </StrictMode>,
      );
    });

    expect(connects).toBe(2);

    const orchestrator = contextPair.contextRef.current?.orchestrator;
    const seeded = orchestrator?.commandProcessor.store.state.instances.get(
      InstanceId('orders-main'),
    );
    expect(seeded?.vesselId).toBe(VesselId('orders'));
    expect(seeded?.variant).toBe(VariantName('list'));
  });
});

describe('Provider initialLayout — post-mount change warning', () => {
  it('does not warn when every render passes a freshly allocated but identical layout', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const contextPair = createMaelstromContext();
    const Provider = createProvider(contextPair, [entry], {});
    const connector = createMockConnector();

    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(
        <Provider connector={connector} initialLayout={freshSeedLayout()}>
          <div />
        </Provider>,
      );
    });
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        view.rerender(
          <Provider connector={connector} initialLayout={freshSeedLayout()}>
            <div />
          </Provider>,
        );
      });
    }

    expect(layoutChangeWarnings(warnSpy.mock.calls)).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it('warns when a genuinely different initialLayout is passed after mount', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const contextPair = createMaelstromContext();
    const Provider = createProvider(contextPair, [entry], {});
    const connector = createMockConnector();

    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(
        <Provider connector={connector} initialLayout={seedLayout}>
          <div />
        </Provider>,
      );
    });
    await act(async () => {
      view.rerender(
        <Provider connector={connector} initialLayout={detailSeedLayout}>
          <div />
        </Provider>,
      );
    });

    const warnings = layoutChangeWarnings(warnSpy.mock.calls);
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.[0])).toContain('captured once on mount');
    warnSpy.mockRestore();
  });

  it('warns only once across successive initialLayout changes', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const contextPair = createMaelstromContext();
    const Provider = createProvider(contextPair, [entry], {});
    const connector = createMockConnector();

    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(
        <Provider connector={connector} initialLayout={seedLayout}>
          <div />
        </Provider>,
      );
    });
    for (const layout of [detailSeedLayout, secondarySeedLayout]) {
      await act(async () => {
        view.rerender(
          <Provider connector={connector} initialLayout={layout}>
            <div />
          </Provider>,
        );
      });
    }

    expect(layoutChangeWarnings(warnSpy.mock.calls)).toHaveLength(1);
    warnSpy.mockRestore();
  });

  it('does not warn when StrictMode double-invokes the mount', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const contextPair = createMaelstromContext();
    const Provider = createProvider(contextPair, [entry], {});
    const connector = createMockConnector();

    await act(async () => {
      render(
        <StrictMode>
          <Provider connector={connector} initialLayout={seedLayout}>
            <div />
          </Provider>
        </StrictMode>,
      );
    });

    expect(layoutChangeWarnings(warnSpy.mock.calls)).toHaveLength(0);
    warnSpy.mockRestore();
  });
});

describe('Provider initialLayout — rejection under layoutMode "grid"', () => {
  it('routes the construction failure to onError and renders nothing', async () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    const errors: Error[] = [];
    const contextPair = createMaelstromContext();
    const Provider = createProvider(contextPair, [entry], {});
    const connector = createMockConnector();

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <Provider
          connector={connector}
          layoutMode="grid"
          // The props union makes this pair unrepresentable; the cast stands
          // in for the untyped (JS) caller the Orchestrator's runtime guard
          // exists to catch.
          initialLayout={seedLayout as never}
          onError={(error) => errors.push(error)}
        >
          <div>alive</div>
        </Provider>,
      ));
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('initialLayout');
    expect(errors[0]?.message).toContain('layoutMode');
    expect(errors[0]?.message).toContain('grid');
    expect(contextPair.contextRef.current).toBeNull();
    expect(container.innerHTML).not.toContain('alive');

    errorSpy.mockRestore();
  });
});

// A new object identity every call, structurally identical every time — the
// literal-inlined-in-JSX case the signature comparison exists to tolerate.
function freshSeedLayout(): TilingLayout {
  return {
    type: 'tiling',
    tree: [InstanceId('orders-main')],
    instances: [
      {
        instanceId: InstanceId('orders-main'),
        vesselId: VesselId('orders'),
        variant: VariantName('list'),
      },
    ],
  };
}

function layoutChangeWarnings(
  calls: readonly unknown[][],
): readonly unknown[][] {
  return calls.filter(
    (call) =>
      typeof call[0] === 'string' &&
      call[0].includes('[Maelstrom] initialLayout prop changed'),
  );
}
