import { expect, test } from 'bun:test';
import { GreetingInterruption } from './greeting-interruption.js';
import { MicrophonePublicationGate } from './microphone-publication-gate.js';

function enabledConfig() {
  return {
    enabled: true as const,
    assetBaseUrl: '/vad-web/',
    preRollMs: 123,
    providerOptions: {},
  };
}

test('disabled preparation keeps raw publication and does not load runtime', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const stream = { getAudioTracks: () => [raw] } as unknown as MediaStream;
  let loads = 0;
  const owner = new GreetingInterruption({
    config: { enabled: false },
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () => {
      loads += 1;
      throw new Error('must not load');
    },
    debug: () => {},
  });
  const prepared = await owner.prepareAndRemember(stream);
  expect(prepared.rawStream).toBe(stream);
  expect(prepared.track).toBe(raw);
  expect(prepared.generated).toBe(false);
  expect(loads).toBe(0);
});

test('accepts one armed local boundary by stopping playback before automatic pre-roll', async () => {
  const raw = { enabled: true, stop: () => {} } as unknown as MediaStreamTrack;
  const generated = {
    enabled: true,
    stop: () => {},
  } as unknown as MediaStreamTrack;
  const order: string[] = [];
  let startTurn: (() => Promise<void>) | undefined;
  let endTurn: (() => Promise<void>) | undefined;
  let cancelTurn: (() => Promise<void>) | undefined;
  let destroys = 0;
  const bridge = {
    track: generated,
    startAutomaticTurn: async (preRollMs: number) => {
      order.push(`automatic:${preRollMs}`);
    },
    startManualTurn: async () => {
      order.push('manual');
    },
    clear: async () => {},
    endTurn: async () => {},
    destroy: async () => {},
  };
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => bridge,
        createBrowserVad: async (options: {
          stream: MediaStream;
          startTurn: () => Promise<void>;
          endTurn: () => Promise<void>;
          cancelTurn: () => Promise<void>;
        }) => {
          expect(options.stream).toBe(rawStream);
          startTurn = options.startTurn;
          endTurn = options.endTurn;
          cancelTurn = options.cancelTurn;
          return {
            destroy: async () => {
              destroys += 1;
            },
          };
        },
      }) as never,
    debug: () => {},
  });
  const rawStream = { getAudioTracks: () => [raw] } as unknown as MediaStream;
  const prepared = await owner.prepareAndRemember(rawStream);
  owner.commit(prepared, {} as RTCRtpSender, 1);
  const operation = owner.begin(() => order.push('stop'));
  if (!operation) throw new Error('expected enabled operation');

  operation.arm();
  await Promise.resolve();
  await startTurn?.();
  await startTurn?.();
  await endTurn?.();
  await cancelTurn?.();
  await operation.settle();

  expect(order).toEqual(['stop', 'automatic:123']);
  expect(generated.enabled).toBe(true);
  expect(raw.enabled).toBe(true);
  expect(destroys).toBe(1);
});

test('settlement waits for a late VAD result and retires it once', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  let resolveVad!: (value: { destroy(): Promise<void> }) => void;
  let destroys = 0;
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async () => {},
          startManualTurn: async () => {},
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {},
        }),
        createBrowserVad: async () =>
          new Promise((resolve) => {
            resolveVad = resolve;
          }),
      }) as never,
    debug: () => {},
  });
  const prepared = await owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  owner.commit(prepared, {} as RTCRtpSender, 1);
  const operation = owner.begin(() => {});
  if (!operation) throw new Error('expected enabled operation');
  operation.arm();
  const settled = operation.settle();
  let complete = false;
  void settled.then(() => {
    complete = true;
  });
  await Promise.resolve();
  expect(complete).toBe(false);
  resolveVad({
    destroy: async () => {
      destroys += 1;
    },
  });
  await settled;
  expect(destroys).toBe(1);
});

test('stale local boundaries cannot become valid after a generation changes', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  let generation = 1;
  let startTurn: (() => Promise<void>) | undefined;
  let automatic = 0;
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => generation),
    generation: () => generation,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async () => {
            automatic += 1;
          },
          startManualTurn: async () => {},
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {},
        }),
        createBrowserVad: async (options: { startTurn(): Promise<void> }) => {
          startTurn = options.startTurn;
          return { destroy: async () => {} };
        },
      }) as never,
    debug: () => {},
  });
  const prepared = await owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  owner.commit(prepared, {} as RTCRtpSender, 1);
  const operation = owner.begin(() => {});
  if (!operation) throw new Error('expected enabled operation');
  operation.arm();
  await Promise.resolve();
  generation = 2;
  await startTurn?.();
  expect(automatic).toBe(0);
  await operation.settle();
});

test('a pre-arm local boundary is ignored and cannot become valid after arm', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  let startTurn: (() => Promise<void>) | undefined;
  let automatic = 0;
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async () => {
            automatic += 1;
          },
          startManualTurn: async () => {},
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {},
        }),
        createBrowserVad: async (options: { startTurn(): Promise<void> }) => {
          startTurn = options.startTurn;
          return { destroy: async () => {} };
        },
      }) as never,
    debug: () => {},
  });
  const prepared = await owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  owner.commit(prepared, {} as RTCRtpSender, 1);
  const operation = owner.begin(() => {});
  if (!operation) throw new Error('expected enabled operation');

  operation.arm();
  await Promise.resolve();
  const oldBoundary = startTurn;
  operation.disarm();
  operation.arm();
  // A fake local boundary can represent noise or echo; it is not speech proof.
  await oldBoundary?.();
  // The old callback cannot become valid under the later arm epoch.
  expect(automatic).toBe(0);
  await operation.settle();
  expect(automatic).toBe(0);
});

test('Skip settles manual publication before releasing the generated gate', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const mutations: boolean[] = [];
  let generatedEnabled = true;
  const generated = {
    get enabled() {
      return generatedEnabled;
    },
    set enabled(value: boolean) {
      generatedEnabled = value;
      mutations.push(value);
    },
  } as MediaStreamTrack;
  const order: string[] = [];
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async () => {},
          startManualTurn: async () => {
            order.push(`manual:${generated.enabled}`);
          },
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {},
        }),
        createBrowserVad: async () => ({ destroy: async () => {} }),
      }) as never,
    debug: () => {},
  });
  const prepared = await owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  owner.commit(prepared, {} as RTCRtpSender, 1);
  const operation = owner.begin(() => {});
  if (!operation) throw new Error('expected enabled operation');

  operation.disarm(); // Skip fences callbacks synchronously before settlement.
  await operation.settle();
  expect(order).toEqual(['manual:false']);
  expect(mutations).toEqual([false, true]);
  expect(raw.enabled).toBe(true);
});

test('a replaced operation cannot accept from its stale local boundary', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  const callbacks: Array<() => Promise<void>> = [];
  let automatic = 0;
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async () => {
            automatic += 1;
          },
          startManualTurn: async () => {},
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {},
        }),
        createBrowserVad: async (options: { startTurn(): Promise<void> }) => {
          callbacks.push(options.startTurn);
          return { destroy: async () => {} };
        },
      }) as never,
    debug: () => {},
  });
  const prepared = await owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  owner.commit(prepared, {} as RTCRtpSender, 1);
  const first = owner.begin(() => {});
  if (!first) throw new Error('expected first operation');
  first.arm();
  await Promise.resolve();
  const second = owner.begin(() => {});
  if (!second) throw new Error('expected second operation');
  await callbacks[0]?.();
  expect(automatic).toBe(0);
  await first.settle();
  await second.settle();
});

test('normal settlement discards greeting-period audio before releasing publication', async () => {
  const raw = { enabled: true, stop: () => {} } as unknown as MediaStreamTrack;
  const generated = {
    enabled: true,
    stop: () => {},
  } as unknown as MediaStreamTrack;
  const order: string[] = [];
  const bridge = {
    track: generated,
    startAutomaticTurn: async () => {},
    startManualTurn: async () => {
      order.push('manual');
    },
    clear: async () => {},
    endTurn: async () => {},
    destroy: async () => {},
  };
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => bridge,
        createBrowserVad: async () => ({ destroy: async () => {} }),
      }) as never,
    debug: () => {},
  });
  const prepared = await owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  owner.commit(prepared, {} as RTCRtpSender, 1);
  const operation = owner.begin(() => {});
  if (!operation) throw new Error('expected enabled operation');

  await operation.settle();
  expect(order).toEqual(['manual']);
  expect(generated.enabled).toBe(true);
});
