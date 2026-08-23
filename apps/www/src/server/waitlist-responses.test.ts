import { describe, expect, test } from 'bun:test';
import { InvalidConfirmToken } from './confirm-request';
import { BodyTooLarge, UnsupportedMediaType } from './signup-request';
import {
  DeliveryStateConflict,
  WaitlistPersistenceError,
} from './waitlist-repository';
import {
  toConfirmDecodeResponse,
  toConfirmFailureResponse,
} from './waitlist-responses';

const confirmUrl = 'https://maelstrom-ai.co/api/waitlist/confirm';

const expectPrivate = (res: Response) => {
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  expect(res.headers.get('x-robots-tag')).toBe('noindex');
};

describe('confirm error mapping', () => {
  test('an unsupported media type is a private 415', async () => {
    const res = toConfirmDecodeResponse(
      new UnsupportedMediaType({}),
      new Request(confirmUrl),
    );
    expect(res.status).toBe(415);
    expectPrivate(res);
    expect(await res.text()).toBe('Unsupported media type.');
  });

  test('an oversized body is a private 413', async () => {
    const res = toConfirmDecodeResponse(
      new BodyTooLarge({}),
      new Request(confirmUrl),
    );
    expect(res.status).toBe(413);
    expectPrivate(res);
  });

  test('an invalid token redirects to the invalid page without a cookie surface', async () => {
    const res = toConfirmDecodeResponse(
      new InvalidConfirmToken({}),
      new Request(confirmUrl),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      'https://maelstrom-ai.co/waitlist/invalid/',
    );
    expectPrivate(res);
    expect(res.headers.getSetCookie?.() ?? []).toEqual([]);
  });

  test('a persistence failure is a private 503 that does not look like a security rejection', async () => {
    const errorLog: Array<unknown> = [];
    const original = console.error;
    console.error = (value: unknown) => {
      errorLog.push(value);
    };
    try {
      const res = toConfirmFailureResponse(
        new WaitlistPersistenceError({ operation: 'confirmToken' }),
      );
      expect(res.status).toBe(503);
      expectPrivate(res);
      expect(await res.text()).toBe(
        'Waitlist confirmation is temporarily unavailable.',
      );
      expect(errorLog).toContainEqual({
        message: 'waitlist confirmation failed',
        category: 'confirmation_store_failed',
      });
    } finally {
      console.error = original;
    }
  });

  test('a delivery-state conflict is the same outage as any other persist failure', async () => {
    const errorLog: Array<unknown> = [];
    const original = console.error;
    console.error = (value: unknown) => {
      errorLog.push(value);
    };
    try {
      const res = toConfirmFailureResponse(new DeliveryStateConflict({}));
      expect(res.status).toBe(503);
      expectPrivate(res);
    } finally {
      console.error = original;
    }
  });
});
