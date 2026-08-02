import { describe, expect, jest, test } from 'bun:test';

import { createLocalAudioPreRoll } from './local-audio-pre-roll.js';

type WorkletMessage = { readonly id?: number; readonly type?: string };

/** Runs one bridge against a fake-timer AudioWorklet and restores browser globals. */
async function withFakeWorklet(
  onMessage: (
    message: WorkletMessage,
    acknowledge: (message: WorkletMessage) => void,
  ) => void,
  run: (context: {
    readonly bridge: Awaited<ReturnType<typeof createLocalAudioPreRoll>>;
    readonly messages: WorkletMessage[];
  }) => Promise<void>,
): Promise<void> {
  const originalAudioContext = globalThis.AudioContext;
  const originalAudioWorkletNode = globalThis.AudioWorkletNode;
  const originalMediaStream = globalThis.MediaStream;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  const generatedTrack = { stop: () => {} } as unknown as MediaStreamTrack;
  const messages: WorkletMessage[] = [];

  class FakeAudioContext {
    sampleRate = 48_000;
    audioWorklet = { addModule: async () => {} };
    createMediaStreamSource() {
      return { connect: (target: unknown) => target, disconnect: () => {} };
    }
    createMediaStreamDestination() {
      return { stream: new MediaStream([generatedTrack]) };
    }
    async resume() {}
    async close() {}
  }
  class FakeAudioWorkletNode {
    port = {
      onmessage: null as
        | ((event: MessageEvent<{ id?: number }>) => void)
        | null,
      postMessage: (message: WorkletMessage) => {
        messages.push(message);
        onMessage(message, (acknowledged) => {
          this.port.onmessage?.({ data: acknowledged } as MessageEvent);
        });
      },
      close: () => {},
    };
    connect(target: unknown) {
      return target;
    }
    disconnect() {}
  }

  jest.useFakeTimers();
  try {
    globalThis.MediaStream = class {
      constructor(readonly tracks: MediaStreamTrack[]) {}
      getAudioTracks() {
        return this.tracks;
      }
    } as unknown as typeof MediaStream;
    globalThis.AudioContext =
      FakeAudioContext as unknown as typeof AudioContext;
    globalThis.AudioWorkletNode =
      FakeAudioWorkletNode as unknown as typeof AudioWorkletNode;
    URL.createObjectURL = () => 'blob:pre-roll';
    URL.revokeObjectURL = () => {};

    const bridge = await createLocalAudioPreRoll({} as MediaStreamTrack);
    await run({ bridge, messages });
    await bridge.destroy();
  } finally {
    jest.useRealTimers();
    globalThis.AudioContext = originalAudioContext;
    globalThis.AudioWorkletNode = originalAudioWorkletNode;
    globalThis.MediaStream = originalMediaStream;
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  }
}

describe('createLocalAudioPreRoll', () => {
  // biome-ignore format: keep the timeout matrix and callback readable.
  test.each([
    [0, 500],
    [250, 1_000],
    [500, 1_500],
  ] as const)(
    'bounds the %ims pre-roll end acknowledgement at exactly %ims',
    async (preRollMs, timeoutMs) => {
      const pendingEnds: Array<{
        readonly message: WorkletMessage;
        readonly acknowledge: (message: WorkletMessage) => void;
      }> = [];
      await withFakeWorklet(
        (message, acknowledge) => {
          if (message.type === 'automatic-start') acknowledge(message);
          if (message.type === 'end') {
            pendingEnds.push({ message, acknowledge });
          }
        },
        async ({ bridge, messages }) => {
          await bridge.startAutomaticTurn(preRollMs);
          const acknowledged = bridge.endTurn();
          let settled = false;
          void acknowledged.finally(() => {
            settled = true;
          });
          jest.advanceTimersByTime(timeoutMs - 1);
          await Promise.resolve();
          expect(settled).toBe(false);
          const firstEnd = pendingEnds.shift();
          if (!firstEnd) throw new Error('expected end request');
          firstEnd.acknowledge(firstEnd.message);
          await acknowledged;

          await bridge.startAutomaticTurn(preRollMs);
          const missing = bridge.endTurn();
          const clearsBefore = messages.filter(
            (message) => message.type === 'clear',
          ).length;
          let missingError: unknown;
          void missing.catch((error) => {
            missingError = error;
          });
          jest.advanceTimersByTime(timeoutMs + 1);
          await Promise.resolve();
          expect(missingError).toEqual(
            new Error('Audio pre-roll worklet request timed out'),
          );
          expect(
            messages.filter((message) => message.type === 'clear').length,
          ).toBe(clearsBefore + 1);
        },
      );
    },
  );

  test('fences a timed-out end acknowledgement from the next request generation', async () => {
    const pendingEnds: Array<{
      readonly message: WorkletMessage;
      readonly acknowledge: (message: WorkletMessage) => void;
    }> = [];
    await withFakeWorklet(
      (message, acknowledge) => {
        if (message.type === 'automatic-start') acknowledge(message);
        if (message.type === 'end') pendingEnds.push({ message, acknowledge });
      },
      async ({ bridge, messages }) => {
        await bridge.startAutomaticTurn(0);
        const first = bridge.endTurn();
        let firstError: unknown;
        void first.catch((error) => {
          firstError = error;
        });
        jest.advanceTimersByTime(501);
        await Promise.resolve();
        expect(firstError).toEqual(
          new Error('Audio pre-roll worklet request timed out'),
        );
        const stale = pendingEnds.shift();
        if (!stale) throw new Error('expected stale end request');

        await bridge.startAutomaticTurn(0);
        const second = bridge.endTurn();
        let secondSettled = false;
        void second.finally(() => {
          secondSettled = true;
        });
        const current = pendingEnds.shift();
        if (!current) throw new Error('expected current end request');
        stale.acknowledge(stale.message);
        await Promise.resolve();
        expect(secondSettled).toBe(false);
        current.acknowledge(current.message);
        await second;
        expect(
          messages.filter((message) => message.type === 'clear'),
        ).toHaveLength(1);
      },
    );
  });

  // biome-ignore format: keep both failed-start variants visibly table-driven.
  test.each(['automatic', 'manual'] as const)(
    'resets active pre-roll after a failed %s start',
    async (failedStart) => {
      let startCount = 0;
      await withFakeWorklet(
        (message, acknowledge) => {
          if (
            message.type === 'automatic-start' ||
            message.type === 'manual-start'
          ) {
            startCount += 1;
            if (startCount === 1) acknowledge(message);
          }
        },
        async ({ bridge }) => {
          await bridge.startAutomaticTurn(500);
          const failed =
            failedStart === 'automatic'
              ? bridge.startAutomaticTurn(500)
              : bridge.startManualTurn();
          let startError: unknown;
          void failed.catch((error) => {
            startError = error;
          });
          jest.advanceTimersByTime(251);
          await Promise.resolve();
          expect(startError).toEqual(
            new Error('Audio pre-roll worklet request timed out'),
          );

          const end = bridge.endTurn();
          let endError: unknown;
          void end.catch((error) => {
            endError = error;
          });
          jest.advanceTimersByTime(501);
          await Promise.resolve();
          expect(endError).toEqual(
            new Error('Audio pre-roll worklet request timed out'),
          );
        },
      );
    },
  );
  test('allows a bounded audio tail to drain before destroying its generation', async () => {
    const originalAudioContext = globalThis.AudioContext;
    const originalAudioWorkletNode = globalThis.AudioWorkletNode;
    const originalMediaStream = globalThis.MediaStream;
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    let contextClosed = 0;
    let contextResumed = 0;
    let sourceDisconnected = 0;
    let nodeDisconnected = 0;
    let portClosed = 0;
    let generatedTrackStopped = 0;
    let processorOptions: { maxSamples: number } | undefined;

    const generatedTrack = {
      stop: () => {
        generatedTrackStopped += 1;
      },
    } as unknown as MediaStreamTrack;
    const sourceNode = {
      connect: (target: unknown) => target,
      disconnect: () => {
        sourceDisconnected += 1;
      },
    };
    class FakeAudioContext {
      sampleRate = 48_000;
      audioWorklet = { addModule: async () => {} };
      createMediaStreamSource() {
        return sourceNode;
      }
      createMediaStreamDestination() {
        return { stream: new MediaStream([generatedTrack]) };
      }
      async resume() {
        contextResumed += 1;
      }
      async close() {
        contextClosed += 1;
      }
    }
    class FakeAudioWorkletNode {
      port = {
        onmessage: null as
          | ((event: MessageEvent<{ id?: number }>) => void)
          | null,
        postMessage: (message: { id?: number; type?: string }) => {
          if (message.id !== undefined) {
            const acknowledge = () =>
              this.port.onmessage?.({ data: message } as MessageEvent);
            if (message.type === 'end') setTimeout(acknowledge, 300);
            else queueMicrotask(acknowledge);
          }
        },
        close: () => {
          portClosed += 1;
        },
      };
      constructor(
        _context: AudioContext,
        _name: string,
        options: { processorOptions: { maxSamples: number } },
      ) {
        processorOptions = options.processorOptions;
      }
      connect(target: unknown) {
        return target;
      }
      disconnect() {
        nodeDisconnected += 1;
      }
    }

    try {
      globalThis.MediaStream = class {
        constructor(readonly tracks: MediaStreamTrack[]) {}
        getAudioTracks() {
          return this.tracks;
        }
      } as unknown as typeof MediaStream;
      globalThis.AudioContext =
        FakeAudioContext as unknown as typeof AudioContext;
      globalThis.AudioWorkletNode =
        FakeAudioWorkletNode as unknown as typeof AudioWorkletNode;
      URL.createObjectURL = () => 'blob:pre-roll';
      URL.revokeObjectURL = () => {};

      const bridge = await createLocalAudioPreRoll({} as MediaStreamTrack);
      await bridge.startAutomaticTurn(250);
      await bridge.endTurn();
      await bridge.destroy();
      await bridge.destroy();

      expect(processorOptions).toEqual({ maxSamples: 24_000 });
      expect(contextResumed).toBe(1);
      expect(contextClosed).toBe(1);
      expect(sourceDisconnected).toBe(1);
      expect(nodeDisconnected).toBe(1);
      expect(portClosed).toBe(1);
      expect(generatedTrackStopped).toBe(1);
    } finally {
      globalThis.AudioContext = originalAudioContext;
      globalThis.AudioWorkletNode = originalAudioWorkletNode;
      globalThis.MediaStream = originalMediaStream;
      URL.createObjectURL = originalCreateObjectUrl;
      URL.revokeObjectURL = originalRevokeObjectUrl;
    }
  });

  test('clears timed-out worklet requests before accepting another turn', async () => {
    const originalAudioContext = globalThis.AudioContext;
    const originalAudioWorkletNode = globalThis.AudioWorkletNode;
    const originalMediaStream = globalThis.MediaStream;
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const generatedTrack = {
      stop: () => {},
    } as unknown as MediaStreamTrack;
    const messages: string[] = [];
    let automaticStarts = 0;

    class FakeAudioContext {
      sampleRate = 48_000;
      audioWorklet = { addModule: async () => {} };
      createMediaStreamSource() {
        return { connect: (target: unknown) => target, disconnect: () => {} };
      }
      createMediaStreamDestination() {
        return { stream: new MediaStream([generatedTrack]) };
      }
      async resume() {}
      async close() {}
    }
    class RecoveringAudioWorkletNode {
      port = {
        onmessage: null as
          | ((event: MessageEvent<{ id?: number }>) => void)
          | null,
        postMessage: (message: { id?: number; type?: string }) => {
          if (message.type) messages.push(message.type);
          if (message.type !== 'automatic-start') return;
          automaticStarts += 1;
          if (automaticStarts === 1 || message.id === undefined) return;
          queueMicrotask(() =>
            this.port.onmessage?.({ data: message } as MessageEvent),
          );
        },
        close: () => {},
      };
      connect(target: unknown) {
        return target;
      }
      disconnect() {}
    }

    try {
      globalThis.MediaStream = class {
        constructor(readonly tracks: MediaStreamTrack[]) {}
        getAudioTracks() {
          return this.tracks;
        }
      } as unknown as typeof MediaStream;
      globalThis.AudioContext =
        FakeAudioContext as unknown as typeof AudioContext;
      globalThis.AudioWorkletNode =
        RecoveringAudioWorkletNode as unknown as typeof AudioWorkletNode;
      URL.createObjectURL = () => 'blob:pre-roll';
      URL.revokeObjectURL = () => {};

      const bridge = await createLocalAudioPreRoll({} as MediaStreamTrack);

      await expect(bridge.startAutomaticTurn(250)).rejects.toThrow(
        'Audio pre-roll worklet request timed out',
      );
      await bridge.startAutomaticTurn(250);
      await expect(bridge.endTurn()).rejects.toThrow(
        'Audio pre-roll worklet request timed out',
      );
      await bridge.startAutomaticTurn(250);

      expect(messages).toEqual([
        'automatic-start',
        'clear',
        'automatic-start',
        'end',
        'clear',
        'automatic-start',
      ]);
      await bridge.destroy();
    } finally {
      globalThis.AudioContext = originalAudioContext;
      globalThis.AudioWorkletNode = originalAudioWorkletNode;
      globalThis.MediaStream = originalMediaStream;
      URL.createObjectURL = originalCreateObjectUrl;
      URL.revokeObjectURL = originalRevokeObjectUrl;
    }
  });
});
