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
      instances: new Map([
        ['a', makeInstance({ position: { row: 0, column: 0 } })],
      ]),
    });
    const { result } = renderHook(() => useTouchedInstances(store));

    act(() => {
      store.setState({
        instances: new Map([
          ['a', makeInstance({ position: { row: 2, column: 1 } })],
        ]),
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

  it('keeps a moved instance flashed after a later empty-diff notification reports an action target (real [set_layout, execute_actions] batch shape)', () => {
    // Regression: the command-processor batch for [set_layout, execute_actions]
    // notifies the store multiple times — 'a' moves on the set_layout
    // notification, then the batch's terminal `status: 'idle'` notification
    // carries no shape diff of its own but is where the execute_actions
    // command_complete's pending action target ('b') gets folded in. Both
    // must still be flashed at the end of the batch.
    const store = createFakeStore({
      status: 'idle',
      instances: new Map([
        ['a', makeInstance()],
        ['b', makeInstance()],
      ]),
    });
    const events = createFakeEvents();
    const { result } = renderHook(() =>
      useTouchedInstances(store, DEFAULT_CLEAR_AFTER_MS, events),
    );

    act(() => {
      // set_layout notification: 'a' moves.
      store.setState({
        status: 'processing',
        instances: new Map([
          ['a', makeInstance({ position: { row: 1, column: 1 } })],
          ['b', makeInstance()],
        ]),
      });
    });
    expect(result.current).toEqual(new Set(['a']));

    act(() => {
      // execute_actions targets 'b', then the batch's terminal idle
      // notification lands with no shape change of its own.
      events.emitCommandComplete({
        command: {
          kind: 'execute_actions',
          executionPlan: [{ instanceId: 'b' }],
        },
      });
      store.setState({
        status: 'idle',
        instances: new Map([
          ['a', makeInstance({ position: { row: 1, column: 1 } })],
          ['b', makeInstance()],
        ]),
      });
    });

    expect(result.current).toEqual(new Set(['a', 'b']));
  });

  it('does not carry a stale flash into a new batch that starts before the old one clears', () => {
    const store = createFakeStore({
      status: 'idle',
      instances: new Map([
        ['a', makeInstance()],
        ['c', makeInstance()],
      ]),
    });
    const { result } = renderHook(() => useTouchedInstances(store));

    act(() => {
      store.setState({
        status: 'idle',
        instances: new Map([
          ['a', makeInstance({ variant: 'expanded' })],
          ['c', makeInstance()],
        ]),
      });
    });
    expect(result.current).toEqual(new Set(['a']));

    act(() => {
      // A fresh batch begins (idle -> processing) before 'a''s flash has
      // been cleared by the debounce timer — 'a' must not linger into a
      // batch that never touched it.
      store.setState({
        status: 'processing',
        instances: new Map([
          ['a', makeInstance({ variant: 'expanded' })],
          ['c', makeInstance()],
        ]),
      });
      store.setState({
        status: 'idle',
        instances: new Map([
          ['a', makeInstance({ variant: 'expanded' })],
          ['c', makeInstance({ variant: 'expanded' })],
        ]),
      });
    });

    expect(result.current).toEqual(new Set(['c']));
  });
});

describe('useFlashInstances', () => {
  function Fixture({ id }: { id: string }) {
    return <div data-instance-id={id} />;
  }

  it('sets data-flash on the matching DOM wrapper', () => {
    const { container, rerender } = render(<Fixture id="abc" />);
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
    expect(
      container
        .querySelector('[data-instance-id="abc"]')
        ?.getAttribute('data-flash'),
    ).toBe('true');

    rerender(
      <>
        <Fixture id="abc" />
        <Flasher touched={new Set()} />
      </>,
    );

    expect(
      container
        .querySelector('[data-instance-id="abc"]')
        ?.getAttribute('data-flash'),
    ).toBeNull();
  });

  it('does not throw for an instanceId containing a raw double-quote (would prematurely close a naive selector string)', () => {
    // Instance ids can be influenced by LLM output. Interpolating one raw
    // into `[data-instance-id="${id}"]` lets an embedded `"` terminate the
    // string early, leaving the rest as malformed selector syntax that
    // throws a SyntaxError and crashes the app.
    const dangerousId = 'foo"]bar';
    function Flasher({ touched }: { touched: ReadonlySet<string> }) {
      useFlashInstances(touched);
      return null;
    }

    expect(() =>
      render(
        <>
          <Fixture id={dangerousId} />
          <Flasher touched={new Set([dangerousId])} />
        </>,
      ),
    ).not.toThrow();
  });

  it('flashes an instanceId containing a selector-metacharacter once escaped', () => {
    // A closing bracket alone doesn't defeat the *string* quoting, but it's
    // still a selector metacharacter CSS.escape() must neutralize so the
    // attribute-selector lookup keeps matching the exact instance id.
    const idWithBracket = 'foo]bar';
    function Flasher({ touched }: { touched: ReadonlySet<string> }) {
      useFlashInstances(touched);
      return null;
    }

    const { container } = render(
      <>
        <Fixture id={idWithBracket} />
        <Flasher touched={new Set([idWithBracket])} />
      </>,
    );

    const node = container.querySelector(
      `[data-instance-id="${idWithBracket}"]`,
    );
    expect(node?.getAttribute('data-flash')).toBe('true');
  });

  it('clears data-flash for the touched ids when the hook unmounts, leaving the DOM node in place', () => {
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
    expect(
      container
        .querySelector('[data-instance-id="abc"]')
        ?.getAttribute('data-flash'),
    ).toBe('true');

    // Unmount only the Flasher (e.g. ActionFlash unmounting) — the Chart-owned
    // DOM wrapper stays in place, so the stale data-flash attribute must not
    // stick around after the hook that wrote it is gone.
    rerender(<Fixture id="abc" />);

    expect(
      container
        .querySelector('[data-instance-id="abc"]')
        ?.getAttribute('data-flash'),
    ).toBeNull();
  });
});
