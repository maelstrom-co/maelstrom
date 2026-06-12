import { describe, expect, test } from 'bun:test';
import { err, isErr, isOk, ok, unwrap } from './result.js';

describe('Result', () => {
  describe('ok', () => {
    test('wraps a value', () => {
      const result = ok(42);
      expect(result).toEqual({ ok: true, value: 42 });
    });

    test('discriminates via .ok', () => {
      const result = ok('hello');
      if (result.ok) {
        expect(result.value).toBe('hello');
      } else {
        throw new Error('Expected ok');
      }
    });
  });

  describe('err', () => {
    test('wraps an error', () => {
      const result = err('bad');
      expect(result).toEqual({ ok: false, error: 'bad' });
    });

    test('discriminates via .ok', () => {
      const result = err({ code: 404 });
      if (!result.ok) {
        expect(result.error).toEqual({ code: 404 });
      } else {
        throw new Error('Expected err');
      }
    });
  });

  describe('isOk / isErr', () => {
    test('isOk returns true for ok result', () => {
      expect(isOk(ok(1))).toBe(true);
      expect(isOk(err('x'))).toBe(false);
    });

    test('isErr returns true for err result', () => {
      expect(isErr(err('x'))).toBe(true);
      expect(isErr(ok(1))).toBe(false);
    });

    test('works as filter predicate', () => {
      const results = [ok(1), err('a'), ok(2), err('b')];
      const successes = results.filter(isOk);
      expect(successes).toHaveLength(2);
      expect(successes.map((r) => r.value)).toEqual([1, 2]);
    });
  });

  describe('unwrap', () => {
    test('returns value for ok result', () => {
      expect(unwrap(ok(42))).toBe(42);
    });

    test('throws error for err result', () => {
      const error = new Error('fail');
      expect(() => unwrap(err(error))).toThrow(error);
    });

    test('wraps non-Error values with stack trace', () => {
      const engineErr = { _tag: 'ParseError', message: 'bad json', raw: '{{' };
      expect(() => unwrap(err(engineErr))).toThrow('bad json');
      try {
        unwrap(err(engineErr));
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect((e as Error).cause).toBe(engineErr);
      }
    });

    test('wraps string errors with stack trace', () => {
      expect(() => unwrap(err('something failed'))).toThrow(
        'unwrap() called on Err result: "something failed"',
      );
    });

    test('wraps null error with descriptive message', () => {
      expect(() => unwrap(err(null))).toThrow(
        'unwrap() called on Err result: null',
      );
    });

    test('wraps undefined error with descriptive message', () => {
      expect(() => unwrap(err(undefined))).toThrow(
        'unwrap() called on Err result: undefined',
      );
    });
  });
});
