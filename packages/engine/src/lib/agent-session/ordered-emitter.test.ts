import { expect, test } from 'bun:test';
import { createOrderedEmitter } from './ordered-emitter.js';

test('every listener sees events in emission order, including events emitted from inside a listener', () => {
  const emitter = createOrderedEmitter<string>();
  const seen: string[][] = [[], []];
  emitter.subscribe((event) => {
    seen[0].push(event);
    if (event === 'first') emitter.emit('nested-1', 'nested-2');
    if (event === 'nested-1') emitter.emit('nested-3');
  });
  emitter.subscribe((event) => {
    seen[1].push(event);
  });
  emitter.emit('first', 'second');
  expect(seen[1]).toEqual([
    'first',
    'second',
    'nested-1',
    'nested-2',
    'nested-3',
  ]);
  expect(seen[0]).toEqual(seen[1]);
});

test('a throwing listener cannot interrupt the caller or later listeners', () => {
  const emitter = createOrderedEmitter<string>();
  const seen: string[] = [];
  emitter.subscribe(() => {
    throw new Error('listener failure');
  });
  emitter.subscribe((event) => {
    seen.push(event);
  });
  expect(() => emitter.emit('first', 'second')).not.toThrow();
  expect(seen).toEqual(['first', 'second']);
  expect(emitter.isDelivering()).toBe(false);
});

test('a rejected promise returned by a listener is handled instead of escaping as an unhandled rejection', async () => {
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', record);
  try {
    const emitter = createOrderedEmitter<string>();
    const seen: string[] = [];
    emitter.subscribe(() =>
      Promise.reject(new Error('async listener failure')),
    );
    emitter.subscribe((event) => {
      seen.push(event);
    });
    emitter.emit('event');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual(['event']);
    expect(unhandled).toEqual([]);
  } finally {
    process.off('unhandledRejection', record);
  }
});

test('the delivery hook runs once per delivered event before listeners, and its failure is contained', () => {
  const calls: string[] = [];
  const emitter = createOrderedEmitter<string>({
    onDeliver: (event) => {
      calls.push(`hook:${event}`);
      throw new Error('hook failure');
    },
  });
  emitter.subscribe((event) => {
    calls.push(`listener:${event}`);
  });
  emitter.emit('first', 'second');
  expect(calls).toEqual([
    'hook:first',
    'listener:first',
    'hook:second',
    'listener:second',
  ]);
});

test('closing from a listener stops later listeners and drops undelivered events', () => {
  const delivered: string[] = [];
  const emitter = createOrderedEmitter<string>({
    onDeliver: (event) => {
      delivered.push(event);
    },
  });
  const seen: string[] = [];
  emitter.subscribe((event) => {
    emitter.emit('nested');
    if (event === 'first') emitter.close();
  });
  emitter.subscribe((event) => {
    seen.push(event);
  });
  emitter.emit('first', 'second');
  emitter.emit('after-close');
  emitter.subscribe((event) => {
    seen.push(`late:${event}`);
  });
  emitter.emit('after-late-subscribe');
  expect(delivered).toEqual(['first']);
  expect(seen).toEqual([]);
});

test('listener changes during delivery take effect from the next event', () => {
  const emitter = createOrderedEmitter<string>();
  const seen: string[] = [];
  let unsubscribeSecond = () => {};
  emitter.subscribe((event) => {
    if (event !== 'first') return;
    unsubscribeSecond();
    emitter.subscribe((late) => {
      seen.push(`late:${late}`);
    });
  });
  unsubscribeSecond = emitter.subscribe((event) => {
    seen.push(`second:${event}`);
  });
  emitter.emit('first', 'second');
  expect(seen).toEqual(['second:first', 'late:second']);
});

test('delivery is reported only while listeners are being called', () => {
  const emitter = createOrderedEmitter<string>();
  const states: boolean[] = [];
  emitter.subscribe(() => {
    states.push(emitter.isDelivering());
  });
  states.push(emitter.isDelivering());
  emitter.emit('event');
  states.push(emitter.isDelivering());
  expect(states).toEqual([false, true, false]);
});
