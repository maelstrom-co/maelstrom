import { expect, test } from 'bun:test';

import { memoryStore } from '../e2e/fixtures/blog/narration';
import { authorizeHeldAttempt, fencedSpeech } from './blog-narration-attempt';

const version = 'a'.repeat(64);
const key = `blog-narration-attempts/${version}/0.json`;

function fixture(objects = new Map<string, string>()) {
  let calls = 0;
  let time = 0;
  const store = memoryStore(objects);
  const options = {
    version,
    index: 0,
    store,
    maySynthesize: true,
    now: () => time,
    async beforeSynthesis() {},
    async request() {
      calls++;
      return Response.json({ valid: true });
    },
    async decode(raw: string) {
      if (JSON.parse(raw).valid !== true) throw new Error('Invalid result');
      return raw;
    },
  };
  return {
    objects,
    store,
    options,
    calls: () => calls,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

test('lost claim acknowledgement sends nothing and holds on a fresh runner', async () => {
  const fake = fixture();
  await expect(
    fencedSpeech({
      ...fake.options,
      store: {
        ...fake.store,
        async compareAndSet(...args) {
          await fake.store.compareAndSet(...args);
          throw new Error('network disconnected after claim');
        },
      },
    }),
  ).rejects.toThrow('network disconnected after claim');
  expect(fake.calls()).toBe(0);
  const fresh = fixture(fake.objects);
  await expect(fencedSpeech(fresh.options)).rejects.toThrow('Held narration');
  expect(fresh.calls()).toBe(0);
});

test('a valid response saved before an interrupted acknowledgement recovers without replay', async () => {
  const fake = fixture();
  await expect(
    fencedSpeech({
      ...fake.options,
      store: {
        ...fake.store,
        async put(key, value) {
          await fake.store.put(key, value);
          throw new Error('lost persistence acknowledgement');
        },
      },
    }),
  ).rejects.toThrow('Held narration');
  expect(fake.calls()).toBe(1);
  const fresh = fixture(fake.objects);
  expect(await fencedSpeech(fresh.options)).toContain('"valid":true');
  expect(fresh.calls()).toBe(0);
});

test('lost response bytes stay held and a specific retry authorization is consumed once', async () => {
  const fake = fixture();
  await expect(
    fencedSpeech({
      ...fake.options,
      store: {
        ...fake.store,
        async put() {
          throw new Error('result storage unavailable before commit');
        },
      },
    }),
  ).rejects.toThrow('Held narration');
  expect(fake.calls()).toBe(1);
  const fresh = fixture(fake.objects);
  await expect(fencedSpeech(fresh.options)).rejects.toThrow('Held narration');
  expect(fresh.calls()).toBe(0);
  const attemptId = JSON.parse(fake.objects.get(key) ?? 'null').id as string;
  const selector = { version, index: 0, attemptId };
  await authorizeHeldAttempt(fake.store, selector);
  await expect(authorizeHeldAttempt(fake.store, selector)).rejects.toThrow(
    'already authorized',
  );
  await expect(
    fencedSpeech({ ...fresh.options, maySynthesize: false }),
  ).rejects.toThrow('Held narration');
  let manualCalls = 0;
  await expect(
    fencedSpeech({
      ...fresh.options,
      async request() {
        manualCalls++;
        throw new Error('request may have been accepted');
      },
    }),
  ).rejects.toThrow('Held narration');
  expect(JSON.parse(fake.objects.get(key) ?? 'null').supersedes).toBe(
    attemptId,
  );
  await expect(authorizeHeldAttempt(fake.store, selector)).rejects.toThrow(
    'no longer held',
  );
  await expect(fencedSpeech(fresh.options)).rejects.toThrow('Held narration');
  expect(manualCalls).toBe(1);
  expect(fresh.calls()).toBe(0);
});

test('invalid success, undocumented 429 and timeout have no automatic retry', async () => {
  for (const request of [
    () => Promise.resolve(Response.json({ invalid: true })),
    () =>
      Promise.resolve(
        Response.json(
          { detail: { code: 'unknown', status: 'system_busy' } },
          { status: 429 },
        ),
      ),
    () =>
      Promise.resolve(
        Response.json({ detail: { code: 'system_busy' } }, { status: 500 }),
      ),
    () => Promise.reject(new Error('timeout')),
  ]) {
    const fake = fixture();
    await expect(fencedSpeech({ ...fake.options, request })).rejects.toThrow(
      'Held narration',
    );
    fake.advance(24 * 60 * 60 * 1000);
    await expect(fencedSpeech(fake.options)).rejects.toThrow('Held narration');
    expect(fake.calls()).toBe(0);
  }
});

test('provider-confirmed rejections honor Retry-After and exhaust the stored attempt budget', async () => {
  const fake = fixture();
  let calls = 0;
  const request = async () => {
    calls++;
    return Response.json(
      {
        detail:
          calls === 1
            ? { code: 'system_busy' }
            : { status: 'too_many_concurrent_requests' },
      },
      { status: 429, headers: { 'retry-after': '300' } },
    );
  };
  for (let count = 1; count <= 3; count++) {
    await expect(fencedSpeech({ ...fake.options, request })).rejects.toThrow(
      'Held narration',
    );
    expect(calls).toBe(count);
    fake.advance(299_000);
    await expect(fencedSpeech({ ...fake.options, request })).rejects.toThrow(
      count === 3 ? 'Held narration' : 'Retry due later',
    );
    expect(calls).toBe(count);
    fake.advance(1000);
  }
  await expect(fencedSpeech(fake.options)).rejects.toThrow('Held narration');
  expect(fake.calls()).toBe(0);
});

test('two publishers racing from absence can send at most one request', async () => {
  const fake = fixture();
  const results = await Promise.allSettled([
    fencedSpeech(fake.options),
    fencedSpeech(fake.options),
  ]);
  expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
    1,
  );
  expect(fake.calls()).toBe(1);
});

test('a confirmed pre-send failure can recover after persisted backoff without an ambiguous retry', async () => {
  const fake = fixture();
  await expect(
    fencedSpeech({
      ...fake.options,
      async beforeSend() {
        throw new Error('stale release');
      },
    }),
  ).rejects.toThrow('stale release');
  expect(fake.calls()).toBe(0);
  await expect(fencedSpeech(fake.options)).rejects.toThrow('Retry due later');
  fake.advance(60_000);
  expect(await fencedSpeech(fake.options)).toContain('"valid":true');
  expect(fake.calls()).toBe(1);
});

test('provider Retry-After may extend the local backoff beyond one hour', async () => {
  const fake = fixture();
  await expect(
    fencedSpeech({
      ...fake.options,
      async request() {
        return Response.json(
          { detail: { code: 'system_busy' } },
          {
            status: 429,
            headers: { 'retry-after': '7200' },
          },
        );
      },
    }),
  ).rejects.toThrow('Held narration');
  fake.advance(3_600_000);
  await expect(fencedSpeech(fake.options)).rejects.toThrow('Retry due later');
  expect(fake.calls()).toBe(0);
  fake.advance(3_600_000);
  await fencedSpeech(fake.options);
  expect(fake.calls()).toBe(1);
});
