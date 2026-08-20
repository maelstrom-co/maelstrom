import { describe, expect, it } from 'bun:test';
import {
  type GreetingInterruptionRuntime,
  loadGreetingInterruptionRuntime,
} from './greeting-interruption-runtime.js';

describe('loadGreetingInterruptionRuntime', () => {
  it('loads the provider-neutral browser runtime through the injected seam', async () => {
    let calls = 0;
    const runtime = {
      createBrowserVad() {},
      createLocalAudioPreRoll() {},
    } as unknown as GreetingInterruptionRuntime;

    await expect(
      loadGreetingInterruptionRuntime(async () => {
        calls += 1;
        return runtime;
      }),
    ).resolves.toBe(runtime);
    expect(calls).toBe(1);
  });

  it('preserves loader rejection for connection-level recovery', async () => {
    const failure = new Error('runtime chunk unavailable');

    await expect(
      loadGreetingInterruptionRuntime(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });
});
