import { describe, expect, it, vi } from 'bun:test';

import { TypedEmitter } from './typed-emitter.js';

type TestEvents = {
  foo: { value: number };
  bar: { message: string };
};

describe('TypedEmitter', () => {
  describe('on', () => {
    it('should register a listener and call it on emit', () => {
      const emitter = new TypedEmitter<TestEvents>();
      const callback = vi.fn();

      emitter.on('foo', callback);
      emitter.emit('foo', { value: 42 });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith({ value: 42 });
    });

    it('should support multiple listeners for the same event', () => {
      const emitter = new TypedEmitter<TestEvents>();
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      emitter.on('foo', cb1);
      emitter.on('foo', cb2);
      emitter.emit('foo', { value: 42 });

      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
    });

    it('should return an unsubscribe function', () => {
      const emitter = new TypedEmitter<TestEvents>();
      const callback = vi.fn();

      const unsub = emitter.on('foo', callback);
      unsub();
      emitter.emit('foo', { value: 42 });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should only register same callback reference once (Set semantics)', () => {
      const emitter = new TypedEmitter<TestEvents>();
      const callback = vi.fn();

      emitter.on('foo', callback);
      emitter.on('foo', callback);
      emitter.emit('foo', { value: 42 });

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should throw when subscribing to a disposed emitter', () => {
      const emitter = new TypedEmitter<TestEvents>();
      emitter.dispose();

      expect(() => emitter.on('foo', vi.fn())).toThrow(
        'Cannot subscribe to a disposed emitter',
      );
    });
  });

  describe('off', () => {
    it('should remove a specific listener', () => {
      const emitter = new TypedEmitter<TestEvents>();
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      emitter.on('foo', cb1);
      emitter.on('foo', cb2);
      emitter.off('foo', cb1);
      emitter.emit('foo', { value: 42 });

      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledTimes(1);
    });

    it('should be safe to call with non-existent listener', () => {
      const emitter = new TypedEmitter<TestEvents>();

      expect(() => {
        emitter.off('foo', vi.fn());
      }).not.toThrow();
    });

    it('should be safe to call unsubscribe function twice', () => {
      const emitter = new TypedEmitter<TestEvents>();
      const unsub = emitter.on('foo', vi.fn());

      expect(() => {
        unsub();
        unsub();
      }).not.toThrow();
    });

    it('should be safe to call off after dispose', () => {
      const emitter = new TypedEmitter<TestEvents>();
      const cb = vi.fn();
      emitter.on('foo', cb);
      emitter.dispose();

      expect(() => emitter.off('foo', cb)).not.toThrow();
    });
  });

  describe('emit', () => {
    it('should not throw when no listeners are registered', () => {
      const emitter = new TypedEmitter<TestEvents>();

      expect(() => {
        emitter.emit('foo', { value: 42 });
      }).not.toThrow();
    });

    it('should only call listeners for the matching event type', () => {
      const emitter = new TypedEmitter<TestEvents>();
      const fooCb = vi.fn();
      const barCb = vi.fn();

      emitter.on('foo', fooCb);
      emitter.on('bar', barCb);
      emitter.emit('foo', { value: 42 });

      expect(fooCb).toHaveBeenCalledTimes(1);
      expect(barCb).not.toHaveBeenCalled();
    });

    it('should catch sync errors in listeners and continue', () => {
      const emitter = new TypedEmitter<TestEvents>();
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const errorCb = vi.fn(() => {
        throw new Error('sync boom');
      });
      const successCb = vi.fn();

      emitter.on('foo', errorCb);
      emitter.on('foo', successCb);
      emitter.emit('foo', { value: 42 });

      expect(errorCb).toHaveBeenCalledTimes(1);
      expect(successCb).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should catch async rejections from listeners', async () => {
      const emitter = new TypedEmitter<TestEvents>();
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      emitter.on('foo', async () => {
        throw new Error('async boom');
      });
      emitter.emit('foo', { value: 42 });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should not prevent sync listeners from running when async listener rejects', async () => {
      const emitter = new TypedEmitter<TestEvents>();
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const syncCb = vi.fn();

      emitter.on('foo', async () => {
        throw new Error('async boom');
      });
      emitter.on('foo', syncCb);
      emitter.emit('foo', { value: 42 });

      expect(syncCb).toHaveBeenCalledTimes(1);

      await new Promise((resolve) => setTimeout(resolve, 0));
      consoleSpy.mockRestore();
    });

    it('should silently no-op after dispose', () => {
      const emitter = new TypedEmitter<TestEvents>();
      const callback = vi.fn();

      emitter.on('foo', callback);
      emitter.dispose();
      emitter.emit('foo', { value: 42 });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle re-entrant emit', () => {
      const emitter = new TypedEmitter<TestEvents>();
      const calls: string[] = [];

      emitter.on('foo', () => {
        calls.push('outer');
        if (calls.length === 1) {
          emitter.emit('foo', { value: 99 });
        }
      });

      emitter.emit('foo', { value: 1 });

      expect(calls).toEqual(['outer', 'outer']);
    });
  });

  describe('disposed', () => {
    it('should be false initially', () => {
      const emitter = new TypedEmitter<TestEvents>();
      expect(emitter.disposed).toBe(false);
    });

    it('should be true after dispose', () => {
      const emitter = new TypedEmitter<TestEvents>();
      emitter.dispose();
      expect(emitter.disposed).toBe(true);
    });
  });

  describe('dispose', () => {
    it('should clear all listeners', () => {
      const emitter = new TypedEmitter<TestEvents>();
      const fooCb = vi.fn();
      const barCb = vi.fn();

      emitter.on('foo', fooCb);
      emitter.on('bar', barCb);
      emitter.dispose();

      // emit no-ops after dispose
      emitter.emit('foo', { value: 42 });
      emitter.emit('bar', { message: 'hello' });

      expect(fooCb).not.toHaveBeenCalled();
      expect(barCb).not.toHaveBeenCalled();
    });

    it('should be idempotent', () => {
      const emitter = new TypedEmitter<TestEvents>();

      expect(() => {
        emitter.dispose();
        emitter.dispose();
      }).not.toThrow();
    });
  });
});
