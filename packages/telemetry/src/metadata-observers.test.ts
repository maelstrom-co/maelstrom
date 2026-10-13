import { expect, test } from 'bun:test';
import { MetadataObservers } from './integration.js';

test('metadata subscription refresh delivers once, skips removed observers, and observes later work', () => {
  const observers = new MetadataObservers();
  const received: string[] = [];
  let release = () => {};
  let removePending = () => {};
  const refresh = (kind: string) => {
    received.push(kind);
    removePending();
    if (received.length < 3) {
      release();
      release = observers.subscribe(refresh);
    }
  };
  release = observers.subscribe(refresh);
  removePending = observers.subscribe(() => {
    received.push('removed');
  });
  observers.emit('first', {});
  expect(received).toEqual(['first']);
  observers.emit('second', {});
  expect(received).toEqual(['first', 'second']);
  release();
  release();
  observers.emit('after release', {});
  expect(received).toEqual(['first', 'second']);
  expect(observers.size).toBe(0);
});

test('throwing and rejecting metadata observers cannot block later observers or reject application work', async () => {
  const observers = new MetadataObservers();
  const received: string[] = [];
  observers.subscribe(() => {
    throw new Error('synchronous');
  });
  observers.subscribe(async () => {
    throw new Error('asynchronous');
  });
  observers.subscribe(() =>
    Object.defineProperty({}, 'then', {
      get() {
        throw new Error('thenable');
      },
    }),
  );
  observers.subscribe((kind) => {
    received.push(kind);
  });
  expect(() => observers.emit('completed', {})).not.toThrow();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(received).toEqual(['completed']);
  observers.clear();
  observers.emit('after cleanup', {});
  expect(received).toEqual(['completed']);
  expect(observers.size).toBe(0);
});
