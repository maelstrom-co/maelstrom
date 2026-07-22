import { describe, expect, test } from "bun:test";

import { createLocalAudioPreRoll } from "./local-audio-pre-roll.js";

describe("createLocalAudioPreRoll", () => {
  test("allows a bounded audio tail to drain before destroying its generation", async () => {
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
            if (message.type === "end") setTimeout(acknowledge, 300);
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
      URL.createObjectURL = () => "blob:pre-roll";
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

  test("clears timed-out worklet requests before accepting another turn", async () => {
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
          if (message.type !== "automatic-start") return;
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
      URL.createObjectURL = () => "blob:pre-roll";
      URL.revokeObjectURL = () => {};

      const bridge = await createLocalAudioPreRoll({} as MediaStreamTrack);

      await expect(bridge.startAutomaticTurn(250)).rejects.toThrow(
        "Audio pre-roll worklet request timed out",
      );
      await bridge.startAutomaticTurn(250);
      await expect(bridge.endTurn()).rejects.toThrow(
        "Audio pre-roll worklet request timed out",
      );
      await bridge.startAutomaticTurn(250);

      expect(messages).toEqual([
        "automatic-start",
        "clear",
        "automatic-start",
        "end",
        "clear",
        "automatic-start",
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
