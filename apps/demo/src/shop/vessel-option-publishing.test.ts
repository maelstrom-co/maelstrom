import {
  MAX_CAPABILITY_OPTION_COUNT,
  MAX_CAPABILITY_OPTIONS_TOTAL_CHARS,
} from '@maelstrom-co/client';
import type { UpdateVesselResult } from '@maelstrom-co/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanOptionValues,
  optionKey,
  republishWithRetry,
} from './vessel-option-publishing';

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('cleanOptionValues', () => {
  it('keeps safe values in order and drops duplicates silently', () => {
    expect(
      cleanOptionValues(['ORD-2', 'ORD-1', 'ORD-2'], 'orders'),
    ).toStrictEqual(['ORD-2', 'ORD-1']);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['the option delimiter', 'DOG|CAT'],
    ['a newline', 'DOG\nCAT'],
    ['a control character', 'DOG\x07'],
    ['only whitespace', '   '],
  ])('drops a value containing %s and names the list in the warning', (_case, value) => {
    expect(cleanOptionValues([value, 'DOG-DRY'], 'cart')).toStrictEqual([
      'DOG-DRY',
    ]);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(
      /^\[shop-option-publishing\] cart: dropped 1 value\(s\) /,
    );
  });

  it('caps the list at the client option count', () => {
    const values = Array.from(
      { length: MAX_CAPABILITY_OPTION_COUNT + 5 },
      (_, i) => `ORD-${i}`,
    );

    const result = cleanOptionValues(values, 'orders');

    expect(result).toStrictEqual(values.slice(0, MAX_CAPABILITY_OPTION_COUNT));
    expect(String(warn.mock.calls[0]?.[0])).toContain('dropping 5 of');
  });

  it('keeps a prefix that fits the character budget', () => {
    const half = 'A'.repeat(MAX_CAPABILITY_OPTIONS_TOTAL_CHARS / 2);
    const overflowing = 'B'.repeat(MAX_CAPABILITY_OPTIONS_TOTAL_CHARS / 2 + 1);

    expect(
      cleanOptionValues([half, overflowing, 'SHORT'], 'cart'),
    ).toStrictEqual([half]);
    expect(String(warn.mock.calls[0]?.[0])).toContain('character budget');
  });

  it('warns that the enum is lost when nothing survives', () => {
    expect(cleanOptionValues(['   '], 'cart')).toStrictEqual([]);
    expect(String(warn.mock.calls.at(-1)?.[0])).toContain(
      'no values survived cleaning',
    );
  });

  it('stays silent for an empty list', () => {
    expect(cleanOptionValues([], 'cart')).toStrictEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('optionKey', () => {
  it('tells apart lists that a delimiter join would collide on', () => {
    expect(optionKey(['a,b'])).not.toBe(optionKey(['a', 'b']));
  });
});

describe('republishWithRetry', () => {
  it('publishes once when accepted', () => {
    const publish = vi.fn(() => accepted());

    republishWithRetry(publish);

    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('retries a batch_in_flight refusal on a backoff until accepted', () => {
    vi.useFakeTimers();
    const publish = vi
      .fn<() => UpdateVesselResult>()
      .mockReturnValueOnce(refused('batch_in_flight'))
      .mockReturnValueOnce(refused('batch_in_flight'))
      .mockReturnValue(accepted());

    republishWithRetry(publish);
    expect(publish).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(publish).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(199);
    expect(publish).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(publish).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(10_000);
    expect(publish).toHaveBeenCalledTimes(3);
  });

  it('gives up after five retries', () => {
    vi.useFakeTimers();
    const publish = vi.fn(() => refused('batch_in_flight'));

    republishWithRetry(publish);
    vi.advanceTimersByTime(60_000);

    expect(publish).toHaveBeenCalledTimes(6);
    expect(String(warn.mock.calls.at(-1)?.[0])).toContain('gave up');
  });

  it('does not retry any other refusal', () => {
    vi.useFakeTimers();
    const publish = vi.fn(() => refused('action_dropped'));

    republishWithRetry(publish);
    vi.advanceTimersByTime(60_000);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('not retrying');
  });

  it('cancels a pending retry on cleanup', () => {
    vi.useFakeTimers();
    const publish = vi.fn(() => refused('batch_in_flight'));

    const cancel = republishWithRetry(publish);
    cancel();
    vi.advanceTimersByTime(60_000);

    expect(publish).toHaveBeenCalledTimes(1);
  });
});

function accepted(): UpdateVesselResult {
  return { ok: true } as UpdateVesselResult;
}

function refused(code: string): UpdateVesselResult {
  return {
    ok: false,
    conflict: { code, vesselId: 'cart', message: 'refused' },
  } as unknown as UpdateVesselResult;
}
