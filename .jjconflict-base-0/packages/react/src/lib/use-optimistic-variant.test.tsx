import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { Vessel } from '@maelstrom-co/protocol';
import {
  ActionName,
  VariantName,
  VesselId,
  VesselSchema,
  defineVessel,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useOptimisticVariant } from './use-optimistic-variant.js';

const vCollapsed = VariantName('collapsed');
const vExpanded = VariantName('expanded');

afterEach(() => cleanup());

// Parsed through VesselSchema so the fixture is a fully branded `Vessel`
// (smart-constructed ids/variant/action names) instead of an erased cast.
const vessel: Vessel = VesselSchema.parse(
  defineVessel({
    id: 'panel',
    name: 'Panel',
    description: 'Test panel',
    defaultVariant: 'collapsed',
    variants: {
      collapsed: {
        props: { mode: 'collapsed' as const },
        minSize: { width: 1, height: 1 },
        actions: [
          { name: 'expand', description: 'Expand', transitionsTo: 'expanded' },
          { name: 'refresh', description: 'Refresh' },
        ],
      },
      expanded: {
        props: { mode: 'expanded' as const },
        minSize: { width: 2, height: 2 },
        actions: [
          {
            name: 'collapse',
            description: 'Collapse',
            transitionsTo: 'collapsed',
          },
        ],
      },
    },
  }),
);

const noop = () => () => {};

interface RenderOptimisticProps {
  instance: { variant: VariantName } | undefined;
  vessel: Vessel | undefined;
  onActionError: (handler: () => void) => () => void;
  timeoutMs?: number;
  debug?: boolean;
}

function renderOptimistic(overrides?: Partial<RenderOptimisticProps>) {
  const props: RenderOptimisticProps = {
    instance: { variant: vCollapsed },
    vessel,
    onActionError: noop,
    ...overrides,
  };

  return renderHook(
    ({
      instance,
      vessel: v,
      onActionError,
      timeoutMs,
      debug,
    }: RenderOptimisticProps) =>
      useOptimisticVariant(instance, v, onActionError, { timeoutMs, debug }),
    { initialProps: props },
  );
}

describe('useOptimisticVariant', () => {
  it('starts with null (no optimistic override)', () => {
    const { result } = renderOptimistic();
    expect(result.current.current).toBeNull();
  });

  it('applyTransition sets optimistic variant and returns true when action has transitionsTo', () => {
    const { result } = renderOptimistic();

    let applied = undefined as boolean | undefined;
    act(() => {
      applied = result.current.applyTransition('expand');
    });

    expect(applied).toBe(true);
    expect(result.current.current).toBe(vExpanded);
  });

  it('applyTransition returns false when action has no transitionsTo', () => {
    const { result } = renderOptimistic();

    let applied = undefined as boolean | undefined;
    act(() => {
      applied = result.current.applyTransition('refresh');
    });

    expect(applied).toBe(false);
    expect(result.current.current).toBeNull();
  });

  it('applyTransition returns false when action does not exist', () => {
    const { result } = renderOptimistic();

    let applied = undefined as boolean | undefined;
    act(() => {
      applied = result.current.applyTransition('nonexistent');
    });

    expect(applied).toBe(false);
    expect(result.current.current).toBeNull();
  });

  it('applyTransition returns false when vessel is undefined', () => {
    const { result } = renderOptimistic({ vessel: undefined });

    let applied = undefined as boolean | undefined;
    act(() => {
      applied = result.current.applyTransition('expand');
    });

    expect(applied).toBe(false);
    expect(result.current.current).toBeNull();
  });

  it('applyTransition returns false when transitionsTo target does not exist', () => {
    // Hand-built so the action can point at a non-existent variant — VesselSchema
    // rejects that drift, so this fixture is branded by hand instead of parsed.
    const badVessel: Vessel = {
      id: VesselId('bad'),
      name: 'Bad',
      description: 'Bad',
      defaultVariant: VariantName('main'),
      variants: {
        [VariantName('main')]: {
          props: {},
          minSize: { width: 1, height: 1 },
          actions: [
            {
              name: ActionName('go'),
              description: 'Go',
              transitionsTo: VariantName('ghost'),
            },
          ],
        },
      },
    };

    const { result } = renderOptimistic({ vessel: badVessel });

    let applied = undefined as boolean | undefined;
    act(() => {
      applied = result.current.applyTransition('go');
    });

    expect(applied).toBe(false);
    expect(result.current.current).toBeNull();
  });

  it('clears optimistic variant when instance reference changes', () => {
    const { result, rerender } = renderOptimistic();

    act(() => result.current.applyTransition('expand'));
    expect(result.current.current).toBe(vExpanded);

    // Simulate engine responding — new instance object
    rerender({
      instance: { variant: vExpanded },
      vessel,
      onActionError: noop,
      timeoutMs: undefined,
    });

    expect(result.current.current).toBeNull();
  });

  it('rolls back optimistic variant when onActionError fires', () => {
    let errorHandler: (() => void) | undefined;
    const onActionError = (handler: () => void) => {
      errorHandler = handler;
      return () => {
        errorHandler = undefined;
      };
    };

    const { result } = renderOptimistic({ onActionError });

    act(() => result.current.applyTransition('expand'));
    expect(result.current.current).toBe(vExpanded);

    act(() => errorHandler!());
    expect(result.current.current).toBeNull();
  });

  it('resolves transitionsTo from the current optimistic variant, not the store variant', () => {
    const { result } = renderOptimistic();

    // First transition: collapsed → expanded
    act(() => result.current.applyTransition('expand'));
    expect(result.current.current).toBe(vExpanded);

    // Second transition: should use expanded's actions (collapse → collapsed)
    act(() => result.current.applyTransition('collapse'));
    expect(result.current.current).toBe(vCollapsed);
  });

  it('unsubscribes from onActionError on unmount', () => {
    let unsubscribed = false;
    const onActionError = (_handler: () => void) => {
      return () => {
        unsubscribed = true;
      };
    };

    const { unmount } = renderOptimistic({ onActionError });
    expect(unsubscribed).toBe(false);

    unmount();
    expect(unsubscribed).toBe(true);
  });

  it('does not cause extra state update when instance changes with no active optimistic variant', () => {
    const { result, rerender } = renderOptimistic();

    expect(result.current.current).toBeNull();

    rerender({
      instance: { variant: vCollapsed },
      vessel,
      onActionError: noop,
      timeoutMs: undefined,
    });

    expect(result.current.current).toBeNull();
  });

  describe('timeout-based rollback', () => {
    let clock: FakeTimers.InstalledClock;

    afterEach(() => {
      clock?.uninstall();
    });

    it('auto-clears optimistic variant after timeout', () => {
      clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
      const { result } = renderOptimistic({ timeoutMs: 100 });

      act(() => result.current.applyTransition('expand'));
      expect(result.current.current).toBe(vExpanded);

      act(() => {
        clock.tick(100);
      });
      expect(result.current.current).toBeNull();
    });

    it('does not auto-clear if store updates before timeout', () => {
      clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
      const { result, rerender } = renderOptimistic({ timeoutMs: 200 });

      act(() => result.current.applyTransition('expand'));
      expect(result.current.current).toBe(vExpanded);

      // Store update clears optimistic before timeout
      rerender({
        instance: { variant: vExpanded },
        vessel,
        onActionError: noop,
        timeoutMs: 200,
      });
      expect(result.current.current).toBeNull();

      // Advancing past timeout should not cause issues
      act(() => {
        clock.tick(300);
      });
      expect(result.current.current).toBeNull();
    });

    it('does not auto-clear if timeoutMs is 0', () => {
      clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
      const { result } = renderOptimistic({ timeoutMs: 0 });

      act(() => result.current.applyTransition('expand'));
      expect(result.current.current).toBe(vExpanded);

      act(() => {
        clock.tick(30_000);
      });
      expect(result.current.current).toBe(vExpanded);
    });

    it('resets timer on successive transitions', () => {
      clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
      const { result } = renderOptimistic({ timeoutMs: 100 });

      act(() => result.current.applyTransition('expand'));
      expect(result.current.current).toBe(vExpanded);

      // Advance 80ms (within first timeout), then trigger second transition
      act(() => {
        clock.tick(80);
      });
      expect(result.current.current).toBe(vExpanded);

      act(() => result.current.applyTransition('collapse'));
      expect(result.current.current).toBe(vCollapsed);

      // 80ms after second transition — first timeout would have fired at 100ms
      // but the timer should have reset
      act(() => {
        clock.tick(80);
      });
      expect(result.current.current).toBe(vCollapsed);

      // Full 100ms after second transition — now it should clear
      act(() => {
        clock.tick(20);
      });
      expect(result.current.current).toBeNull();
    });

    it('emits console.warn on timeout when debug is true', () => {
      clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
      const warnSpy = mock(() => {});
      const originalWarn = console.warn;
      console.warn = warnSpy;

      try {
        const { result } = renderOptimistic({ timeoutMs: 100, debug: true });

        act(() => result.current.applyTransition('expand'));
        expect(result.current.current).toBe(vExpanded);

        act(() => {
          clock.tick(100);
        });
        expect(result.current.current).toBeNull();

        const timeoutWarn = warnSpy.mock.calls.find(
          (c: unknown[]) =>
            typeof c[0] === 'string' && c[0].includes('timed out'),
        );
        expect(timeoutWarn).toBeDefined();
      } finally {
        console.warn = originalWarn;
      }
    });

    it('cleans up timeout on unmount', () => {
      clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
      const { result, unmount } = renderOptimistic({ timeoutMs: 100 });

      act(() => result.current.applyTransition('expand'));
      expect(result.current.current).toBe(vExpanded);

      unmount();
      // Advancing past timeout after unmount should not throw
      act(() => {
        clock.tick(200);
      });
    });
  });
});
