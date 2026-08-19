import { expect, test } from 'bun:test';
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
