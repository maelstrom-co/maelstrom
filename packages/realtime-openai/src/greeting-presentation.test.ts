import { expect, test } from 'bun:test';
import { GreetingInterruption } from './greeting-interruption.js';
import { GreetingPresentation } from './greeting-presentation.js';
import { MicrophonePublicationGate } from './microphone-publication-gate.js';

function harness(
  options: { readonly ready?: boolean; readonly sendThrows?: boolean } = {},
) {
  const sent: string[] = [];
  const track = { enabled: true } as MediaStreamTrack;
  const stream = { getAudioTracks: () => [track] } as unknown as MediaStream;
  let stopped = 0;
  let played = 0;
  const player = {
    activate: () => {},
    ensureReady: async () => ({ ok: options.ready ?? true }),
    play: async () => {
      played += 1;
    },
    stop: () => {
      stopped += 1;
    },
  };
  const presentation = new GreetingPresentation({
    synthesize: async () => new ArrayBuffer(1),
    voice: 'marin',
    gate: new MicrophonePublicationGate(() => 1),
    player: player as never,
    channel: () =>
      ({
        readyState: 'open',
        send: (message: string) => {
          if (options.sendThrows) throw new Error('send');
          sent.push(message);
        },
      }) as never,
    microphone: () => stream,
    generation: () => 1,
    debug: () => {},
  });
  return {
    presentation,
    sent,
    track,
    get stopped() {
      return stopped;
    },
    get played() {
      return played;
    },
  };
}

test('GreetingPresentation returns not_started without a configured synthesizer', async () => {
  const presentation = new GreetingPresentation({
    voice: 'marin',
    gate: new MicrophonePublicationGate(),
    player: {} as never,
    channel: () => undefined,
    microphone: () => undefined,
    generation: () => 1,
    debug: () => {},
  });
  await expect(
    presentation.speak({
      id: 'id' as never,
      text: 'hello',
      signal: new AbortController().signal,
    }),
  ).resolves.toBe('not_started');
});

test('activation is synchronous, repeatable, and swallows player errors', () => {
  let activations = 0;
  const presentation = new GreetingPresentation({
    synthesize: async () => new ArrayBuffer(1),
    voice: 'marin',
    gate: new MicrophonePublicationGate(),
    player: {
      activate: () => {
        activations += 1;
        throw new Error('locked');
      },
    } as never,
    channel: () => undefined,
    microphone: () => undefined,
    generation: () => 1,
    debug: () => {},
  });
  expect(() => {
    presentation.activate();
    presentation.activate();
  }).not.toThrow();
  expect(activations).toBe(2);
});

test('hands off the exact assistant item before synthesis and never creates a response', async () => {
  const h = harness();
  await expect(
    h.presentation.speak({
      id: 'id' as never,
      text: 'hello',
      signal: new AbortController().signal,
    }),
  ).resolves.toBe('accepted');
  expect(JSON.parse(h.sent[0]!)).toEqual({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'hello' }],
    },
  });
  expect(h.played).toBe(1);
  expect(h.track.enabled).toBe(true);
});

test('readiness and pre-send failures remain retriable without gating microphone', async () => {
  const notReady = harness({ ready: false });
  await expect(
    notReady.presentation.speak({
      id: 'id' as never,
      text: 'hello',
      signal: new AbortController().signal,
    }),
  ).resolves.toBe('not_started');
  expect(notReady.track.enabled).toBe(true);
  const sendFailed = harness({ sendThrows: true });
  await expect(
    sendFailed.presentation.speak({
      id: 'id' as never,
      text: 'hello',
      signal: new AbortController().signal,
    }),
  ).resolves.toBe('not_started');
  expect(sendFailed.track.enabled).toBe(true);
});

test('post-send synthesis failure emits only a bounded diagnostic and restores the gate', async () => {
  const track = { enabled: true } as MediaStreamTrack;
  const diagnostics: string[] = [];
  const presentation = new GreetingPresentation({
    synthesize: async () => {
      throw new Error('synthesis');
    },
    voice: 'marin',
    gate: new MicrophonePublicationGate(() => 1),
    player: {
      activate: () => {},
      ensureReady: async () => ({ ok: true }),
      play: async () => {},
      stop: () => {},
    } as never,
    channel: () => ({ readyState: 'open', send: () => {} }) as never,
    microphone: () => ({ getAudioTracks: () => [track] }) as never,
    generation: () => 1,
    debug: (category) => diagnostics.push(category),
  });
  await expect(
    presentation.speak({
      id: 'id' as never,
      text: 'hello',
      signal: new AbortController().signal,
    }),
  ).resolves.toBe('accepted');
  expect(track.enabled).toBe(true);
  expect(diagnostics).toEqual(['presentation-failed']);
});

test('closed channel and caller abort are retriable without provider handoff', async () => {
  const aborted = new AbortController();
  aborted.abort();
  const presentation = new GreetingPresentation({
    synthesize: async () => new ArrayBuffer(1),
    voice: 'marin',
    gate: new MicrophonePublicationGate(),
    player: {} as never,
    channel: () => ({ readyState: 'closed' }) as never,
    microphone: () => undefined,
    generation: () => 1,
    debug: () => {},
  });
  await expect(
    presentation.speak({
      id: 'id' as never,
      text: 'hello',
      signal: aborted.signal,
    }),
  ).resolves.toBe('not_started');
});

test('enabled owner gates only generated publication, then accepts a current playback boundary', async () => {
  const order: string[] = [];
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  let boundary: (() => Promise<void>) | undefined;
  const interruption = new GreetingInterruption({
    config: {
      enabled: true,
      assetBaseUrl: '/vad-web/',
      preRollMs: 42,
      providerOptions: {},
    },
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async (preRollMs: number) => {
            order.push(`automatic:${preRollMs}`);
          },
          startManualTurn: async () => order.push('manual'),
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {},
        }),
        createBrowserVad: async (options: { startTurn(): Promise<void> }) => {
          boundary = options.startTurn;
          return { destroy: async () => {} };
        },
      }) as never,
    debug: () => {},
  });
  const stream = { getAudioTracks: () => [raw] } as unknown as MediaStream;
  const prepared = await interruption.prepareAndRemember(stream);
  interruption.commit(prepared, {} as RTCRtpSender, 1);
  const presentation = new GreetingPresentation({
    synthesize: async () => {
      order.push('synthesize');
      return new ArrayBuffer(1);
    },
    voice: 'marin',
    gate: new MicrophonePublicationGate(() => 1),
    player: {
      activate: () => {},
      ensureReady: async () => ({ ok: true }),
      play: async (
        _bytes: ArrayBuffer,
        _signal: AbortSignal,
        hooks: {
          onPlaybackStart?(): void;
          onPlaybackEnd?(): void;
        },
      ) => {
        hooks.onPlaybackStart?.();
        await Promise.resolve();
        order.push(`during:${raw.enabled}/${generated.enabled}`);
        await boundary?.();
        hooks.onPlaybackEnd?.();
      },
      stop: () => order.push('stop'),
    } as never,
    channel: () =>
      ({
        readyState: 'open',
        send: () => order.push('send'),
      }) as never,
    microphone: () => stream,
    generation: () => 1,
    debug: () => {},
    interruption,
  });

  await expect(
    presentation.speak({
      id: 'id' as never,
      text: 'hello',
      signal: new AbortController().signal,
    }),
  ).resolves.toBe('accepted');
  expect(order).toEqual([
    'send',
    'synthesize',
    'during:true/false',
    'stop',
    'automatic:42',
    'stop',
  ]);
  expect(raw.enabled).toBe(true);
  expect(generated.enabled).toBe(true);
});

test('enabled natural completion waits for manual bridge settlement before publication release', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  const order: string[] = [];
  const gate = new MicrophonePublicationGate(() => 1);
  const interruption = new GreetingInterruption({
    config: {
      enabled: true,
      assetBaseUrl: '/vad-web/',
      preRollMs: 1,
      providerOptions: {},
    },
    gate,
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async () => order.push('automatic'),
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
  const stream = { getAudioTracks: () => [raw] } as unknown as MediaStream;
  const prepared = await interruption.prepareAndRemember(stream);
  interruption.commit(prepared, {} as RTCRtpSender, 1);
  const presentation = new GreetingPresentation({
    synthesize: async () => new ArrayBuffer(1),
    voice: 'marin',
    gate,
    player: {
      activate: () => {},
      ensureReady: async () => ({ ok: true }),
      play: async (
        _bytes: ArrayBuffer,
        _signal: AbortSignal,
        hooks: {
          onPlaybackStart?(): void;
          onPlaybackEnd?(): void;
        },
      ) => {
        hooks.onPlaybackStart?.();
        hooks.onPlaybackEnd?.();
      },
      stop: () => {},
    } as never,
    channel: () => ({ readyState: 'open', send: () => {} }) as never,
    microphone: () => stream,
    generation: () => 1,
    debug: () => {},
    interruption,
  });
  await presentation.speak({
    id: 'id' as never,
    text: 'hello',
    signal: new AbortController().signal,
  });
  expect(order).toEqual(['manual:false']);
  expect(generated.enabled).toBe(true);
  expect(raw.enabled).toBe(true);
});

test('enabled Skip retains the generated gate until manual bridge settlement', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  let resolveManual!: () => void;
  const manual = new Promise<void>((resolve) => {
    resolveManual = resolve;
  });
  let started!: () => void;
  const gate = new MicrophonePublicationGate(() => 1);
  const interruption = new GreetingInterruption({
    config: {
      enabled: true,
      assetBaseUrl: '/vad-web/',
      preRollMs: 1,
      providerOptions: {},
    },
    gate,
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async () => {},
          startManualTurn: async () => manual,
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {},
        }),
        createBrowserVad: async () => ({ destroy: async () => {} }),
      }) as never,
    debug: () => {},
  });
  const stream = { getAudioTracks: () => [raw] } as unknown as MediaStream;
  const prepared = await interruption.prepareAndRemember(stream);
  interruption.commit(prepared, {} as RTCRtpSender, 1);
  const presentation = new GreetingPresentation({
    synthesize: async () => new ArrayBuffer(1),
    voice: 'marin',
    gate,
    player: {
      activate: () => {},
      ensureReady: async () => ({ ok: true }),
      play: async (
        _bytes: ArrayBuffer,
        _signal: AbortSignal,
        hooks: {
          onPlaybackStart?(): void;
        },
      ) => {
        hooks.onPlaybackStart?.();
        await new Promise<void>((resolve) => {
          started = resolve;
        });
      },
      stop: () => started(),
    } as never,
    channel: () => ({ readyState: 'open', send: () => {} }) as never,
    microphone: () => stream,
    generation: () => 1,
    debug: () => {},
    interruption,
  });
  const speech = presentation.speak({
    id: 'id' as never,
    text: 'hello',
    signal: new AbortController().signal,
  });
  for (let attempt = 0; attempt < 10 && !started; attempt += 1)
    await Promise.resolve();
  presentation.abort();
  expect(generated.enabled).toBe(false);
  resolveManual();
  await speech;
  expect(generated.enabled).toBe(true);
  expect(raw.enabled).toBe(true);
});

test('enabled synthesis and decode cannot accept a local boundary', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  const order: string[] = [];
  let resolveSynthesis!: (value: ArrayBuffer) => void;
  let startPlayback!: () => void;
  let finishPlayback!: () => void;
  let hooks:
    | {
        onPlaybackStart?(): void;
        onPlaybackEnd?(): void;
      }
    | undefined;
  let vadCreates = 0;
  const gate = new MicrophonePublicationGate(() => 1);
  const interruption = new GreetingInterruption({
    config: {
      enabled: true,
      assetBaseUrl: '/vad-web/',
      preRollMs: 9,
      providerOptions: {},
    },
    gate,
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async () => order.push('automatic'),
          startManualTurn: async () => order.push('manual'),
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {},
        }),
        createBrowserVad: async () => {
          vadCreates += 1;
          return { destroy: async () => {} };
        },
      }) as never,
    debug: () => {},
  });
  const stream = { getAudioTracks: () => [raw] } as unknown as MediaStream;
  const prepared = await interruption.prepareAndRemember(stream);
  interruption.commit(prepared, {} as RTCRtpSender, 1);
  const presentation = new GreetingPresentation({
    synthesize: () =>
      new Promise<ArrayBuffer>((resolve) => {
        resolveSynthesis = resolve;
      }),
    voice: 'marin',
    gate,
    player: {
      activate: () => {},
      ensureReady: async () => ({ ok: true }),
      play: async (
        _bytes: ArrayBuffer,
        _signal: AbortSignal,
        playbackHooks: {
          onPlaybackStart?(): void;
          onPlaybackEnd?(): void;
        },
      ) => {
        hooks = playbackHooks;
        await new Promise<void>((resolve) => {
          startPlayback = resolve;
        });
        playbackHooks.onPlaybackStart?.();
        await new Promise<void>((resolve) => {
          finishPlayback = resolve;
        });
        playbackHooks.onPlaybackEnd?.();
      },
      stop: () => {},
    } as never,
    channel: () => ({ readyState: 'open', send: () => {} }) as never,
    microphone: () => stream,
    generation: () => 1,
    debug: () => {},
    interruption,
  });
  const speech = presentation.speak({
    id: 'id' as never,
    text: 'hello',
    signal: new AbortController().signal,
  });
  for (let attempt = 0; attempt < 10 && !resolveSynthesis; attempt += 1)
    await Promise.resolve();
  expect(generated.enabled).toBe(false);
  expect(vadCreates).toBe(0);
  expect(order).toEqual([]);
  resolveSynthesis(new ArrayBuffer(1));
  for (let attempt = 0; attempt < 10 && !hooks; attempt += 1)
    await Promise.resolve();
  expect(generated.enabled).toBe(false);
  expect(vadCreates).toBe(0);
  expect(order).toEqual([]);
  startPlayback();
  for (let attempt = 0; attempt < 10 && vadCreates === 0; attempt += 1)
    await Promise.resolve();
  expect(vadCreates).toBe(1);
  finishPlayback();
  await expect(speech).resolves.toBe('accepted');
  expect(order).toEqual(['manual']);
  expect(raw.enabled).toBe(true);
});

test('enabled replacement fences stale playback hooks and local boundaries', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  const order: string[] = [];
  const hooks: Array<{
    onPlaybackStart?(): void;
    onPlaybackEnd?(): void;
  }> = [];
  const boundaries: Array<() => Promise<void>> = [];
  let firstPlay!: () => void;
  const gate = new MicrophonePublicationGate(() => 1);
  const interruption = new GreetingInterruption({
    config: {
      enabled: true,
      assetBaseUrl: '/vad-web/',
      preRollMs: 11,
      providerOptions: {},
    },
    gate,
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async () => order.push('automatic'),
          startManualTurn: async () => order.push('manual'),
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {},
        }),
        createBrowserVad: async (options: { startTurn(): Promise<void> }) => {
          boundaries.push(options.startTurn);
          return { destroy: async () => {} };
        },
      }) as never,
    debug: () => {},
  });
  const stream = { getAudioTracks: () => [raw] } as unknown as MediaStream;
  const prepared = await interruption.prepareAndRemember(stream);
  interruption.commit(prepared, {} as RTCRtpSender, 1);
  const presentation = new GreetingPresentation({
    synthesize: async () => new ArrayBuffer(1),
    voice: 'marin',
    gate,
    player: {
      activate: () => {},
      ensureReady: async () => ({ ok: true }),
      play: async (
        _bytes: ArrayBuffer,
        _signal: AbortSignal,
        playbackHooks: {
          onPlaybackStart?(): void;
          onPlaybackEnd?(): void;
        },
      ) => {
        hooks.push(playbackHooks);
        playbackHooks.onPlaybackStart?.();
        if (hooks.length === 1) {
          await new Promise<void>((resolve) => {
            firstPlay = resolve;
          });
        }
        playbackHooks.onPlaybackEnd?.();
      },
      stop: () => firstPlay?.(),
    } as never,
    channel: () => ({ readyState: 'open', send: () => {} }) as never,
    microphone: () => stream,
    generation: () => 1,
    debug: () => {},
    interruption,
  });
  const first = presentation.speak({
    id: 'one' as never,
    text: 'one',
    signal: new AbortController().signal,
  });
  for (let attempt = 0; attempt < 10 && hooks.length === 0; attempt += 1)
    await Promise.resolve();
  const second = presentation.speak({
    id: 'two' as never,
    text: 'two',
    signal: new AbortController().signal,
  });
  for (let attempt = 0; attempt < 10 && hooks.length < 2; attempt += 1)
    await Promise.resolve();
  hooks[0]?.onPlaybackStart?.();
  hooks[0]?.onPlaybackEnd?.();
  await boundaries[0]?.();
  expect(order).toEqual(['manual']);
  await expect(first).resolves.toBe('accepted');
  await expect(second).resolves.toBe('accepted');
  expect(order).toEqual(['manual', 'manual']);
  expect(generated.enabled).toBe(true);
  expect(raw.enabled).toBe(true);
});

test('enabled synthesis-period callback plus later setup failure cannot flush before playback start', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  const order: string[] = [];
  let resolveSynthesis!: (value: ArrayBuffer) => void;
  let finishPlayback!: () => void;
  const interruption = new GreetingInterruption({
    config: {
      enabled: true,
      assetBaseUrl: '/vad-web/',
      preRollMs: 1,
      providerOptions: {},
    },
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async () => order.push('automatic'),
          startManualTurn: async () => order.push('manual'),
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {},
        }),
        createBrowserVad: async () => {
          throw new Error('vad start');
        },
      }) as never,
    replacePublication: async () => {
      order.push('replace');
      return 'replaced';
    },
    debug: () => {},
  });
  const stream = { getAudioTracks: () => [raw] } as unknown as MediaStream;
  const prepared = await interruption.prepareAndRemember(stream);
  interruption.commit(prepared, {} as RTCRtpSender, 1);
  const presentation = new GreetingPresentation({
    synthesize: () =>
      new Promise<ArrayBuffer>((resolve) => {
        resolveSynthesis = resolve;
      }),
    voice: 'marin',
    gate: new MicrophonePublicationGate(() => 1),
    player: {
      activate: () => {},
      ensureReady: async () => ({ ok: true }),
      play: async (
        _bytes: ArrayBuffer,
        _signal: AbortSignal,
        hooks: { onPlaybackStart?(): void; onPlaybackEnd?(): void },
      ) => {
        hooks.onPlaybackStart?.();
        await new Promise<void>((resolve) => {
          finishPlayback = resolve;
        });
        hooks.onPlaybackEnd?.();
      },
      stop: () => finishPlayback?.(),
    } as never,
    channel: () => ({ readyState: 'open', send: () => {} }) as never,
    microphone: () => stream,
    generation: () => 1,
    debug: () => {},
    interruption,
  });
  const speech = presentation.speak({
    id: 'id' as never,
    text: 'hello',
    signal: new AbortController().signal,
  });
  for (let attempt = 0; attempt < 10 && !resolveSynthesis; attempt += 1)
    await Promise.resolve();
  expect(order).toEqual([]);
  resolveSynthesis(new ArrayBuffer(1));
  for (
    let attempt = 0;
    attempt < 10 && !order.includes('replace');
    attempt += 1
  )
    await Promise.resolve();
  expect(order).toEqual(['replace']);
  await speech;
  expect(order).not.toContain('automatic');
});

test('enabled speak after pre-attachment fallback uses the existing raw gate', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const diagnostics: string[] = [];
  const interruption = new GreetingInterruption({
    config: {
      enabled: true,
      assetBaseUrl: '/vad-web/',
      preRollMs: 1,
      providerOptions: {},
    },
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () => {
      throw new Error('chunk missing');
    },
    debug: (category) => diagnostics.push(category),
  });
  const stream = { getAudioTracks: () => [raw] } as unknown as MediaStream;
  const prepared = await interruption.prepareAndRemember(stream);
  expect(prepared.generated).toBe(false);
  interruption.commit(prepared, {} as RTCRtpSender, 1);
  const presentation = new GreetingPresentation({
    synthesize: async () => new ArrayBuffer(1),
    voice: 'marin',
    gate: new MicrophonePublicationGate(() => 1),
    player: {
      activate: () => {},
      ensureReady: async () => ({ ok: true }),
      play: async () => {
        expect(raw.enabled).toBe(false);
      },
      stop: () => {},
    } as never,
    channel: () => ({ readyState: 'open', send: () => {} }) as never,
    microphone: () => stream,
    generation: () => 1,
    debug: () => {},
    interruption,
  });
  await expect(
    presentation.speak({
      id: 'id' as never,
      text: 'hello',
      signal: new AbortController().signal,
    }),
  ).resolves.toBe('accepted');
  expect(raw.enabled).toBe(true);
  expect(diagnostics).toEqual(['runtime-unavailable']);
});

test('publication gate remains held through playback', async () => {
  const track = { enabled: true } as MediaStreamTrack;
  let finishPlayback!: () => void;
  const presentation = new GreetingPresentation({
    synthesize: async () => new ArrayBuffer(1),
    voice: 'marin',
    gate: new MicrophonePublicationGate(() => 1),
    player: {
      activate: () => {},
      ensureReady: async () => ({ ok: true }),
      play: () =>
        new Promise<void>((resolve) => {
          finishPlayback = resolve;
        }),
      stop: () => {},
    } as never,
    channel: () => ({ readyState: 'open', send: () => {} }) as never,
    microphone: () => ({ getAudioTracks: () => [track] }) as never,
    generation: () => 1,
    debug: () => {},
  });
  const speech = presentation.speak({
    id: 'id' as never,
    text: 'hello',
    signal: new AbortController().signal,
  });
  for (let attempt = 0; attempt < 10 && !finishPlayback; attempt += 1)
    await Promise.resolve();
  expect(track.enabled).toBe(false);
  finishPlayback();
  await speech;
  expect(track.enabled).toBe(true);
});

test('replacement releases the first operation and stale completion cannot restore the successor gate', async () => {
  const track = { enabled: true } as MediaStreamTrack;
  let firstResolve!: (value: ArrayBuffer) => void;
  let secondResolve!: (value: ArrayBuffer) => void;
  let invocation = 0;
  const presentation = new GreetingPresentation({
    synthesize: () =>
      new Promise<ArrayBuffer>((resolve) => {
        if (invocation++ === 0) firstResolve = resolve;
        else secondResolve = resolve;
      }),
    voice: 'marin',
    gate: new MicrophonePublicationGate(() => 1),
    player: {
      activate: () => {},
      ensureReady: async () => ({ ok: true }),
      play: async () => {},
      stop: () => {},
    } as never,
    channel: () => ({ readyState: 'open', send: () => {} }) as never,
    microphone: () => ({ getAudioTracks: () => [track] }) as never,
    generation: () => 1,
    debug: () => {},
  });
  const first = presentation.speak({
    id: 'one' as never,
    text: 'one',
    signal: new AbortController().signal,
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(track.enabled).toBe(false);
  const second = presentation.speak({
    id: 'two' as never,
    text: 'two',
    signal: new AbortController().signal,
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(track.enabled).toBe(false);
  firstResolve(new ArrayBuffer(1));
  await first;
  expect(track.enabled).toBe(false);
  presentation.abort();
  presentation.abort();
  expect(track.enabled).toBe(true);
  secondResolve(new ArrayBuffer(1));
  await second;
});

test('Skip abort restores a gated microphone synchronously', async () => {
  let resolve!: (value: ArrayBuffer) => void;
  const h = harness();
  const pending = new GreetingPresentation({
    synthesize: () =>
      new Promise<ArrayBuffer>((r) => {
        resolve = r;
      }),
    voice: 'marin',
    gate: new MicrophonePublicationGate(() => 1),
    player: {
      activate: () => {},
      ensureReady: async () => ({ ok: true }),
      play: async () => {},
      stop: () => {},
    } as never,
    channel: () => ({ readyState: 'open', send: () => {} }) as never,
    microphone: () =>
      h.track ? ({ getAudioTracks: () => [h.track] } as never) : undefined,
    generation: () => 1,
    debug: () => {},
  });
  const speaking = pending.speak({
    id: 'id' as never,
    text: 'hello',
    signal: new AbortController().signal,
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(h.track.enabled).toBe(false);
  pending.abort();
  expect(h.track.enabled).toBe(true);
  resolve(new ArrayBuffer(1));
  await expect(speaking).resolves.toBe('accepted');
});
