import { afterEach, describe, expect, it } from 'bun:test';
import type { Vessel } from '@maelstrom-co/protocol-old';
import { defineVessel } from '@maelstrom-co/protocol-old';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useOptimisticVariant } from './use-optimistic-variant.js';

afterEach(() => cleanup());

const vessel = defineVessel({
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
        { name: 'collapse', description: 'Collapse', transitionsTo: 'collapsed' },
      ],
    },
  },
});

const noop = () => () => {};

function renderOptimistic(overrides?: {
  instance?: { variant: string };
  vessel?: Vessel;
  onActionError?: (handler: () => void) => () => void;
}) {
  const props = {
    instance: { variant: 'collapsed' } as { variant: string } | undefined,
    vessel: vessel as Vessel | undefined,
    onActionError: noop,
    ...overrides,
  };

  return renderHook(
    ({ instance, vessel: v, onActionError }: typeof props) =>
      useOptimisticVariant(instance, v, onActionError),
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

    let applied: boolean;
    act(() => { applied = result.current.applyTransition('expand'); });

    expect(applied!).toBe(true);
    expect(result.current.current).toBe('expanded');
  });

  it('applyTransition returns false when action has no transitionsTo', () => {
    const { result } = renderOptimistic();

    let applied: boolean;
    act(() => { applied = result.current.applyTransition('refresh'); });

    expect(applied!).toBe(false);
    expect(result.current.current).toBeNull();
  });

  it('applyTransition returns false when action does not exist', () => {
    const { result } = renderOptimistic();

    let applied: boolean;
    act(() => { applied = result.current.applyTransition('nonexistent'); });

    expect(applied!).toBe(false);
    expect(result.current.current).toBeNull();
  });

  it('applyTransition returns false when vessel is undefined', () => {
    const { result } = renderOptimistic({ vessel: undefined });

    let applied: boolean;
    act(() => { applied = result.current.applyTransition('expand'); });

    expect(applied!).toBe(false);
    expect(result.current.current).toBeNull();
  });

  it('applyTransition returns false when transitionsTo target does not exist', () => {
    const badVessel = defineVessel({
      id: 'bad',
      name: 'Bad',
      description: 'Bad',
      defaultVariant: 'main',
      variants: {
        main: {
          props: {},
          minSize: { width: 1, height: 1 },
          actions: [{ name: 'go', description: 'Go', transitionsTo: 'ghost' }],
        },
      },
    });

    const { result } = renderOptimistic({ vessel: badVessel });

    let applied: boolean;
    act(() => { applied = result.current.applyTransition('go'); });

    expect(applied!).toBe(false);
    expect(result.current.current).toBeNull();
  });

  it('clears optimistic variant when instance reference changes', () => {
    const { result, rerender } = renderOptimistic();

    act(() => result.current.applyTransition('expand'));
    expect(result.current.current).toBe('expanded');

    // Simulate engine responding — new instance object
    rerender({
      instance: { variant: 'expanded' },
      vessel,
      onActionError: noop,
    });

    expect(result.current.current).toBeNull();
  });

  it('rolls back optimistic variant when onActionError fires', () => {
    let errorHandler: (() => void) | undefined;
    const onActionError = (handler: () => void) => {
      errorHandler = handler;
      return () => { errorHandler = undefined; };
    };

    const { result } = renderOptimistic({ onActionError });

    act(() => result.current.applyTransition('expand'));
    expect(result.current.current).toBe('expanded');

    act(() => errorHandler!());
    expect(result.current.current).toBeNull();
  });

  it('resolves transitionsTo from the current optimistic variant, not the store variant', () => {
    const { result } = renderOptimistic();

    // First transition: collapsed → expanded
    act(() => result.current.applyTransition('expand'));
    expect(result.current.current).toBe('expanded');

    // Second transition: should use expanded's actions (collapse → collapsed)
    act(() => result.current.applyTransition('collapse'));
    expect(result.current.current).toBe('collapsed');
  });

  it('unsubscribes from onActionError on unmount', () => {
    let unsubscribed = false;
    const onActionError = (_handler: () => void) => {
      return () => { unsubscribed = true; };
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
      instance: { variant: 'collapsed' },
      vessel,
      onActionError: noop,
    });

    expect(result.current.current).toBeNull();
  });
});
