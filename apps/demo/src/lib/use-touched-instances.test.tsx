// @vitest-environment happy-dom

import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CommandEventsLike,
  InstancesStoreLike,
  InstancesStoreState,
} from './use-touched-instances';
import {
  DEFAULT_CLEAR_AFTER_MS,
  useFlashInstances,
  useTouchedInstances,
} from './use-touched-instances';

interface FakeInstance {
  variant: string;
  position: { row: number; column: number };
  size: { width: number; height: number };
}

function makeInstance(overrides: Partial<FakeInstance> = {}): FakeInstance {
  return {
    variant: 'default',
    position: { row: 0, column: 0 },
    size: { width: 1, height: 1 },
    ...overrides,
  };
}

function createFakeStore(initial: InstancesStoreState): InstancesStoreLike & {
  setState: (next: InstancesStoreState) => void;
} {
  const listeners = new Set<(value: InstancesStoreState) => void>();
  let state = initial;
  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return { unsubscribe: () => listeners.delete(listener) };
    },
    setState(next) {
      state = next;
      for (const listener of listeners) listener(next);
    },
  };
}

type CommandCompleteHandler = Parameters<CommandEventsLike['on']>[1];

function createFakeEvents(): CommandEventsLike & {
  emitCommandComplete: (payload: Parameters<CommandCompleteHandler>[0]) => void;
} {
  const listeners = new Set<CommandCompleteHandler>();
  return {
    on(_event, cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    emitCommandComplete(payload) {
      for (const listener of listeners) listener(payload);
    },
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useTouchedInstances', () => {
  it('reports an instanceId whose variant changed', () => {
    const store = createFakeStore({
      instances: new Map([['a', makeInstance({ variant: 'compact' })]]),
    });
    const { result } = renderHook(() => useTouchedInstances(store));

    act(() => {
      store.setState({
        instances: new Map([['a', makeInstance({ variant: 'expanded' })]]),
      });
    });

    expect(result.current).toEqual(new Set(['a']));
  });

  it('reports an instanceId whose position changed but variant/size did not', () => {
    const store = createFakeStore({
      instances: new Map([['a', makeInstance({ position: { row: 0, column: 0 } })]]),
    });
    const { result } = renderHook(() => useTouchedInstances(store));

    act(() => {
      store.setState({
        instances: new Map([['a', makeInstance({ position: { row: 2, column: 1 } })]]),
      });
    });

    expect(result.current).toEqual(new Set(['a']));
  });

  it('reports an empty set when nothing changed', () => {
    const store = createFakeStore({
      instances: new Map([['a', makeInstance()]]),
    });
    const { result } = renderHook(() => useTouchedInstances(store));

    act(() => {
      store.setState({
        instances: new Map([['a', makeInstance()]]),
      });
    });

    expect(result.current).toEqual(new Set());
  });

  it('does not report a newly-added instance (enter animation covers it)', () => {
    const store = createFakeStore({
      instances: new Map([['a', makeInstance()]]),
    });
    const { result } = renderHook(() => useTouchedInstances(store));

    act(() => {
      store.setState({
        instances: new Map([
          ['a', makeInstance()],
          ['b', makeInstance({ variant: 'expanded' })],
        ]),
      });
    });

    expect(result.current).toEqual(new Set());
  });

  it('does not report an untouched sibling instance', () => {
    const store = createFakeStore({
      instances: new Map([
        ['a', makeInstance()],
        ['b', makeInstance()],
      ]),
    });
    const { result } = renderHook(() => useTouchedInstances(store));

    act(() => {
      store.setState({
        instances: new Map([
          ['a', makeInstance({ variant: 'expanded' })],
          ['b', makeInstance()],
        ]),
      });
    });

    expect(result.current).toEqual(new Set(['a']));
  });

  it('clears the touched set after the timeout elapses', () => {
    vi.useFakeTimers();
    const store = createFakeStore({
      instances: new Map([['a', makeInstance()]]),
    });
    const { result } = renderHook(() => useTouchedInstances(store, 1200));

    act(() => {
      store.setState({
        instances: new Map([['a', makeInstance({ variant: 'expanded' })]]),
      });
    });
    expect(result.current).toEqual(new Set(['a']));

    act(() => {
      vi.advanceTimersByTime(1199);
    });
    expect(result.current).toEqual(new Set(['a']));

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toEqual(new Set());
  });

  it('flags an instance targeted by an executed action even when its shape is unchanged', () => {
    // The interruption beat ("skip the gym, add coffee at 9") mutates
    // calendar events via an executed action — no {variant, position, size}
    // change — so the shape diff alone reports nothing.
    const store = createFakeStore({
      instances: new Map([['a', makeInstance()]]),
    });
    const events = createFakeEvents();
    const { result } = renderHook(() =>
      useTouchedInstances(store, DEFAULT_CLEAR_AFTER_MS, events),
    );

    act(() => {
      events.emitCommandComplete({
        command: {
          kind: 'execute_actions',
          executionPlan: [{ instanceId: 'a' }],
        },
      });
      store.setState({ instances: new Map([['a', makeInstance()]]) });
    });

    expect(result.current).toEqual(new Set(['a']));
  });

  it('does not flag an action target that entered the board in the same settle', () => {
    const store = createFakeStore({ instances: new Map() });
    const events = createFakeEvents();
    const { result } = renderHook(() =>
      useTouchedInstances(store, DEFAULT_CLEAR_AFTER_MS, events),
    );

    act(() => {
      events.emitCommandComplete({
        command: {
          kind: 'execute_actions',
          executionPlan: [{ instanceId: 'b' }],
        },
      });
      store.setState({ instances: new Map([['b', makeInstance()]]) });
    });

    expect(result.current).toEqual(new Set());
  });

  it('ignores command_complete events for set_layout commands', () => {
    const store = createFakeStore({
      instances: new Map([['a', makeInstance()]]),
    });
    const events = createFakeEvents();
    const { result } = renderHook(() =>
      useTouchedInstances(store, DEFAULT_CLEAR_AFTER_MS, events),
    );

    act(() => {
      events.emitCommandComplete({
        command: { kind: 'set_layout' },
      });
      store.setState({ instances: new Map([['a', makeInstance()]]) });
    });

    expect(result.current).toEqual(new Set());
  });
});

describe('useFlashInstances', () => {
  function Fixture({ id }: { id: string }) {
    return <div data-instance-id={id} />;
  }

  it('sets data-flash on the matching DOM wrapper', () => {
    const { container, rerender } = render(
      <>
        <Fixture id="abc" />
      </>,
    );
    function Flasher({ touched }: { touched: ReadonlySet<string> }) {
      useFlashInstances(touched);
      return null;
    }

    rerender(
      <>
        <Fixture id="abc" />
        <Flasher touched={new Set(['abc'])} />
      </>,
    );

    const node = container.querySelector('[data-instance-id="abc"]');
    expect(node?.getAttribute('data-flash')).toBe('true');
  });

  it('removes data-flash once the instance drops out of the touched set', () => {
    function Flasher({ touched }: { touched: ReadonlySet<string> }) {
      useFlashInstances(touched);
      return null;
    }

    const { container, rerender } = render(
      <>
        <Fixture id="abc" />
        <Flasher touched={new Set(['abc'])} />
      </>,
    );
    expect(container.querySelector('[data-instance-id="abc"]')?.getAttribute('data-flash')).toBe(
      'true',
    );

    rerender(
      <>
        <Fixture id="abc" />
        <Flasher touched={new Set()} />
      </>,
    );

    expect(container.querySelector('[data-instance-id="abc"]')?.getAttribute('data-flash')).toBeNull();
  });
});
