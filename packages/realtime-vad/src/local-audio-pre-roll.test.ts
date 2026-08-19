import { describe, expect, jest, test } from 'bun:test';

import { createLocalAudioPreRoll } from './local-audio-pre-roll.js';

type WorkletMessage = {
  readonly id?: number;
  readonly samples?: number;
  readonly type?: string;
};

type Processor = {
  port: { onmessage: ((event: { data: WorkletMessage }) => void) | null; posted: WorkletMessage[] };
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

/** Loads the Blob-backed processor through the same module hook used by the bridge. */
async function createProcessor(maxSamples = 4): Promise<Processor> {
  const workletGlobal = globalThis as typeof globalThis & {
    AudioWorkletProcessor?: unknown;
  };
  const originalAudioWorkletProcessor = workletGlobal.AudioWorkletProcessor;
  let registered: (new (options: { processorOptions: { maxSamples: number } }) => Processor) | undefined;
  class FakeAudioWorkletProcessor {
    port = {
      onmessage: null as ((event: { data: WorkletMessage }) => void) | null,
      posted: [] as WorkletMessage[],
      postMessage: (message: WorkletMessage) => {
        this.port.posted.push(message);
      },
    };
  }

  try {
    workletGlobal.AudioWorkletProcessor = FakeAudioWorkletProcessor;
    const originalAudioContext = globalThis.AudioContext;
    const originalAudioWorkletNode = globalThis.AudioWorkletNode;
    const originalMediaStream = globalThis.MediaStream;
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    let source = '';
    class Context {
      sampleRate = 8;
      audioWorklet = {
        addModule: async () => {
          // Blob.text() keeps this test coupled to the embedded worklet source.
          source = await blob!.text();
          new Function('AudioWorkletProcessor', 'registerProcessor', source)(
            FakeAudioWorkletProcessor,
            (
              _name: string,
              processor: new (options: {
                processorOptions: { maxSamples: number };
              }) => Processor,
            ) => {
              registered = processor;
            },
          );
        },
      };
      createMediaStreamSource() {
        return { connect: (target: unknown) => target, disconnect: () => {} };
      }
      createMediaStreamDestination() {
        return {
          stream: new MediaStream([
            { enabled: true, stop: () => {} } as unknown as MediaStreamTrack,
          ]),
        };
      }
      async resume() {}
      async close() {}
    }
    class Node {
      port = { onmessage: null, postMessage: () => {}, close: () => {} };
      connect(target: unknown) {
        return target;
      }
      disconnect() {}
    }
    let blob: Blob | undefined;
    try {
      globalThis.MediaStream = class {
        constructor(readonly tracks: MediaStreamTrack[]) {}
        getAudioTracks() {
          return this.tracks;
        }
      } as unknown as typeof MediaStream;
      globalThis.AudioContext = Context as unknown as typeof AudioContext;
      globalThis.AudioWorkletNode = Node as unknown as typeof AudioWorkletNode;
      URL.createObjectURL = (value: Blob) => {
        blob = value;
        return 'blob:processor';
      };
      URL.revokeObjectURL = () => {};
      const bridge = await createLocalAudioPreRoll({} as MediaStreamTrack);
      await bridge.destroy();
    } finally {
      globalThis.AudioContext = originalAudioContext;
      globalThis.AudioWorkletNode = originalAudioWorkletNode;
      globalThis.MediaStream = originalMediaStream;
      URL.createObjectURL = originalCreateObjectUrl;
      URL.revokeObjectURL = originalRevokeObjectUrl;
    }
    if (!registered) throw new Error('processor was not registered');
    return new registered({ processorOptions: { maxSamples } });
  } finally {
    workletGlobal.AudioWorkletProcessor = originalAudioWorkletProcessor;
  }
}

function process(processor: Processor, values: number[]): number[] {
  const output = new Float32Array(values.length);
  processor.process([ [Float32Array.from(values)] ], [[output]]);
  return [...output];
}

function message(processor: Processor, data: WorkletMessage) {
  processor.port.onmessage?.({ data });
}

describe('local audio pre-roll processor', () => {
  test('keeps only the newest closed tail and emits silence while closed', async () => {
    const processor = await createProcessor();
    expect(process(processor, [1, 2, 3])).toEqual([0, 0, 0]);
    expect(process(processor, [4, 5, 6])).toEqual([0, 0, 0]);
    message(processor, { type: 'automatic-start', id: 1, samples: 4 });
    expect(processor.port.posted).toEqual([{ id: 1 }]);
    expect(process(processor, [7, 8, 9, 10])).toEqual([3, 4, 5, 6]);
    expect(process(processor, [11, 12, 13, 14])).toEqual([7, 8, 9, 10]);
  });

  test('selects zero or a shorter newest tail before live input', async () => {
    const processor = await createProcessor();
    process(processor, [1, 2, 3, 4]);
    message(processor, { type: 'automatic-start', id: 1, samples: 2 });
    expect(process(processor, [5, 6, 7, 8])).toEqual([3, 4, 5, 6]);

    message(processor, { type: 'clear', id: 2 });
    process(processor, [9, 10, 11, 12]);
    message(processor, { type: 'automatic-start', id: 3, samples: 0 });
    expect(process(processor, [13, 14, 15, 16])).toEqual([13, 14, 15, 16]);
  });

  test('clears an older queued tail for a rapid later automatic start', async () => {
    const processor = await createProcessor();
    process(processor, [1, 2, 3, 4]);
    message(processor, { type: 'automatic-start', id: 1, samples: 4 });
    message(processor, { type: 'automatic-start', id: 2, samples: 4 });
    expect(process(processor, [5, 6, 7, 8])).toEqual([5, 6, 7, 8]);
    expect(processor.port.posted).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test.each(['idle', 'automatic', 'manual'] as const)(
    'acknowledges clear and discards retained samples from %s mode',
    async (mode) => {
      const processor = await createProcessor();
      process(processor, [1, 2, 3, 4]);
      if (mode === 'automatic')
        message(processor, { type: 'automatic-start', id: 1, samples: 4 });
      if (mode === 'manual')
        message(processor, { type: 'manual-start', id: 1 });
      message(processor, { type: 'clear', id: 2 });
      expect(processor.port.posted.at(-1)).toEqual({ id: 2 });
      expect(process(processor, [5, 6, 7, 8])).toEqual([0, 0, 0, 0]);
    },
  );

  test('manual and clear discard old samples, including a pending end', async () => {
    const processor = await createProcessor();
    process(processor, [1, 2, 3, 4]);
    message(processor, { type: 'automatic-start', id: 1, samples: 4 });
    message(processor, { type: 'end', id: 2 });
    message(processor, { type: 'clear', id: 3 });
    expect(processor.port.posted).toEqual([{ id: 1 }, { id: 3 }]);
    expect(process(processor, [5, 6, 7, 8])).toEqual([0, 0, 0, 0]);
    message(processor, { type: 'manual-start', id: 4 });
    expect(process(processor, [9, 10, 11, 12])).toEqual([9, 10, 11, 12]);
    message(processor, { type: 'clear' });
    expect(process(processor, [13, 14, 15, 16])).toEqual([0, 0, 0, 0]);
  });

  test('drains accepted automatic audio before acknowledging end', async () => {
    const processor = await createProcessor();
    process(processor, [1, 2, 3, 4]);
    message(processor, { type: 'automatic-start', id: 1, samples: 4 });
    message(processor, { type: 'end', id: 2 });
    expect(processor.port.posted).toEqual([{ id: 1 }]);
    expect(process(processor, [9, 9, 9, 9])).toEqual([1, 2, 3, 4]);
    expect(processor.port.posted).toEqual([{ id: 1 }, { id: 2 }]);
    expect(process(processor, [5, 6, 7, 8])).toEqual([0, 0, 0, 0]);
  });
});

/** Runs one bridge with a controllable Web Audio graph and restores all globals. */
async function withBridge(
  onMessage: (message: WorkletMessage, acknowledge: (message: WorkletMessage) => void) => void,
  run: (bridge: Awaited<ReturnType<typeof createLocalAudioPreRoll>>, messages: WorkletMessage[]) => Promise<void>,
): Promise<void> {
  const originals = {
    AudioContext: globalThis.AudioContext,
    AudioWorkletNode: globalThis.AudioWorkletNode,
    MediaStream: globalThis.MediaStream,
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
  };
  const messages: WorkletMessage[] = [];
  const generated = { enabled: true, stop: () => {} } as unknown as MediaStreamTrack;
  class Context {
    sampleRate = 48_000;
    audioWorklet = { addModule: async () => {} };
    createMediaStreamSource() {
      return { connect: (target: unknown) => target, disconnect: () => {} };
    }
    createMediaStreamDestination() {
      return { stream: new MediaStream([generated]) };
    }
    async resume() {}
    async close() {}
  }
  class Node {
    port = {
      onmessage: null as ((event: MessageEvent<{ id?: number }>) => void) | null,
      postMessage: (message: WorkletMessage) => {
        messages.push(message);
        onMessage(message, (acknowledged) =>
          this.port.onmessage?.({ data: acknowledged } as MessageEvent),
        );
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
    globalThis.AudioContext = Context as unknown as typeof AudioContext;
    globalThis.AudioWorkletNode = Node as unknown as typeof AudioWorkletNode;
    URL.createObjectURL = () => 'blob:pre-roll';
    URL.revokeObjectURL = () => {};
    const bridge = await createLocalAudioPreRoll({} as MediaStreamTrack);
    await run(bridge, messages);
    await bridge.destroy();
  } finally {
    jest.useRealTimers();
    globalThis.AudioContext = originals.AudioContext;
    globalThis.AudioWorkletNode = originals.AudioWorkletNode;
    globalThis.MediaStream = originals.MediaStream;
    URL.createObjectURL = originals.createObjectURL;
    URL.revokeObjectURL = originals.revokeObjectURL;
  }
}

describe('createLocalAudioPreRoll lifecycle', () => {
  test.each([
    [0, 500],
    [250, 1_000],
    [500, 1_500],
  ] as const)('uses the exact end acknowledgement limit for %ims', async (preRollMs, timeoutMs) => {
    const ends: Array<{ message: WorkletMessage; acknowledge: (message: WorkletMessage) => void }> = [];
    await withBridge(
      (message, acknowledge) => {
        if (message.type === 'automatic-start') acknowledge(message);
        if (message.type === 'end') ends.push({ message, acknowledge });
      },
      async (bridge, messages) => {
        await bridge.startAutomaticTurn(preRollMs);
        const ending = bridge.endTurn();
        jest.advanceTimersByTime(timeoutMs - 1);
        const end = ends.shift();
        if (!end) throw new Error('expected end request');
        end.acknowledge(end.message);
        await ending;

        await bridge.startAutomaticTurn(preRollMs);
        const missing = bridge.endTurn();
        jest.advanceTimersByTime(timeoutMs + 1);
        await expect(missing).rejects.toThrow('Audio pre-roll worklet request timed out');
        expect(messages.filter((entry) => entry.type === 'clear')).toHaveLength(1);
      },
    );
  });

  test('fences late acknowledgements and recovers after a timeout', async () => {
    const ends: Array<{ message: WorkletMessage; acknowledge: (message: WorkletMessage) => void }> = [];
    await withBridge(
      (message, acknowledge) => {
        if (message.type === 'automatic-start') acknowledge(message);
        if (message.type === 'end') ends.push({ message, acknowledge });
      },
      async (bridge) => {
        await bridge.startAutomaticTurn(0);
        const first = bridge.endTurn();
        jest.advanceTimersByTime(501);
        await expect(first).rejects.toThrow('Audio pre-roll worklet request timed out');
        const stale = ends.shift();
        if (!stale) throw new Error('expected stale end');

        await bridge.startAutomaticTurn(0);
        const second = bridge.endTurn();
        const current = ends.shift();
        if (!current) throw new Error('expected current end');
        stale.acknowledge(stale.message);
        let settled = false;
        void second.finally(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);
        current.acknowledge(current.message);
        await second;
      },
    );
  });

  test('rejects unsupported APIs', async () => {
    const originalAudioContext = globalThis.AudioContext;
    const originalAudioWorkletNode = globalThis.AudioWorkletNode;
    try {
      globalThis.AudioContext = undefined as unknown as typeof AudioContext;
      globalThis.AudioWorkletNode = undefined as unknown as typeof AudioWorkletNode;
      await expect(createLocalAudioPreRoll({} as MediaStreamTrack)).rejects.toThrow(
        'AudioWorklet pre-roll is not supported in this browser',
      );
    } finally {
      globalThis.AudioContext = originalAudioContext;
      globalThis.AudioWorkletNode = originalAudioWorkletNode;
    }
  });

  test('clamps start samples and configures the 48 kHz maximum tail', async () => {
    const originals = {
      AudioContext: globalThis.AudioContext,
      AudioWorkletNode: globalThis.AudioWorkletNode,
      MediaStream: globalThis.MediaStream,
      createObjectURL: URL.createObjectURL,
      revokeObjectURL: URL.revokeObjectURL,
    };
    const messages: WorkletMessage[] = [];
    let options: { processorOptions: { maxSamples: number } } | undefined;
    class Context {
      sampleRate = 48_000;
      audioWorklet = { addModule: async () => {} };
      createMediaStreamSource() { return { connect: (target: unknown) => target, disconnect: () => {} }; }
      createMediaStreamDestination() {
        return { stream: new MediaStream([{ enabled: true, stop: () => {} } as unknown as MediaStreamTrack]) };
      }
      async resume() {}
      async close() {}
    }
    class Node {
      port = {
        onmessage: null as ((event: MessageEvent<{ id?: number }>) => void) | null,
        postMessage: (entry: WorkletMessage) => {
          messages.push(entry);
          this.port.onmessage?.({ data: entry } as MessageEvent);
        },
        close: () => {},
      };
      constructor(_context: AudioContext, _name: string, nodeOptions: typeof options) { options = nodeOptions; }
      connect(target: unknown) { return target; }
      disconnect() {}
    }
    try {
      globalThis.MediaStream = class {
        constructor(readonly tracks: MediaStreamTrack[]) {}
        getAudioTracks() { return this.tracks; }
      } as unknown as typeof MediaStream;
      globalThis.AudioContext = Context as unknown as typeof AudioContext;
      globalThis.AudioWorkletNode = Node as unknown as typeof AudioWorkletNode;
      URL.createObjectURL = () => 'blob:options';
      URL.revokeObjectURL = () => {};
      const bridge = await createLocalAudioPreRoll({} as MediaStreamTrack);
      await bridge.startAutomaticTurn(Number.NaN);
      await bridge.startAutomaticTurn(-1);
      await bridge.startAutomaticTurn(999);
      expect(options).toMatchObject({ processorOptions: { maxSamples: 24_000 } });
      expect(messages.filter((entry) => entry.type === 'automatic-start').map((entry) => entry.samples)).toEqual([0, 0, 24_000]);
      await bridge.destroy();
    } finally {
      globalThis.AudioContext = originals.AudioContext;
      globalThis.AudioWorkletNode = originals.AudioWorkletNode;
      globalThis.MediaStream = originals.MediaStream;
      URL.createObjectURL = originals.createObjectURL;
      URL.revokeObjectURL = originals.revokeObjectURL;
    }
  });

  test.each(['automatic-start', 'manual-start', 'clear'] as const)(
    'uses the exact ordinary timeout and resets active duration after failed %s',
    async (failedType) => {
      let automaticStarts = 0;
      let latest: { readonly entry: WorkletMessage; readonly acknowledge: (entry: WorkletMessage) => void } | undefined;
      await withBridge(
        (entry, acknowledge) => {
          latest = { entry, acknowledge };
          if (entry.type === 'automatic-start' && automaticStarts++ === 0) acknowledge(entry);
        },
        async (bridge) => {
          // Seed every row, including automatic-start, with an active 500 ms tail.
          await bridge.startAutomaticTurn(500);
          const acknowledged = failedType === 'automatic-start'
            ? bridge.startAutomaticTurn(500)
            : failedType === 'manual-start'
              ? bridge.startManualTurn()
              : bridge.clear();
          let settled = false;
          void acknowledged.finally(() => { settled = true; });
          jest.advanceTimersByTime(249);
          await Promise.resolve();
          expect(settled).toBe(false);
          latest?.acknowledge(latest.entry);
          await acknowledged;

          // Manual and clear acknowledgements reset the active duration, so
          // re-establish a 500 ms automatic turn immediately before failure.
          const reseeded = bridge.startAutomaticTurn(500);
          latest?.acknowledge(latest.entry);
          await reseeded;
          const failed = failedType === 'automatic-start'
            ? bridge.startAutomaticTurn(500)
            : failedType === 'manual-start'
              ? bridge.startManualTurn()
              : bridge.clear();
          jest.advanceTimersByTime(251);
          await expect(failed).rejects.toThrow('Audio pre-roll worklet request timed out');
          const end = bridge.endTurn();
          jest.advanceTimersByTime(501);
          await expect(end).rejects.toThrow('Audio pre-roll worklet request timed out');
        },
      );
    },
  );

  test('ignores unknown and duplicate acknowledgement IDs', async () => {
    let acknowledge: ((message: WorkletMessage) => void) | undefined;
    await withBridge(
      (entry, ack) => { if (entry.type === 'automatic-start') acknowledge = ack; },
      async (bridge) => {
        const start = bridge.startAutomaticTurn(0);
        let settled = false;
        void start.finally(() => { settled = true; });
        acknowledge?.({ id: 999 });
        await Promise.resolve();
        expect(settled).toBe(false);
        acknowledge?.({ id: 1 });
        await start;
        acknowledge?.({ id: 1 });
        const manual = bridge.startManualTurn();
        jest.advanceTimersByTime(251);
        await expect(manual).rejects.toThrow('Audio pre-roll worklet request timed out');
      },
    );
  });

  test('cleans up a missing generated track while preserving its initialization error', async () => {
    const originals = {
      AudioContext: globalThis.AudioContext,
      AudioWorkletNode: globalThis.AudioWorkletNode,
      MediaStream: globalThis.MediaStream,
    };
    let sourceDisconnects = 0;
    let contextCloses = 0;
    class Context {
      sampleRate = 48_000;
      audioWorklet = { addModule: async () => {} };
      createMediaStreamSource() {
        return { connect: (target: unknown) => target, disconnect: () => { sourceDisconnects += 1; throw new Error('cleanup failure'); } };
      }
      createMediaStreamDestination() { return { stream: new MediaStream([]) }; }
      async resume() {}
      async close() { contextCloses += 1; throw new Error('cleanup failure'); }
    }
    try {
      globalThis.MediaStream = class {
        constructor(readonly tracks: MediaStreamTrack[]) {}
        getAudioTracks() { return this.tracks; }
      } as unknown as typeof MediaStream;
      globalThis.AudioContext = Context as unknown as typeof AudioContext;
      globalThis.AudioWorkletNode = class {} as unknown as typeof AudioWorkletNode;
      await expect(createLocalAudioPreRoll({} as MediaStreamTrack)).rejects.toThrow('AudioWorklet produced no audio track');
      expect([sourceDisconnects, contextCloses]).toEqual([1, 1]);
    } finally {
      globalThis.AudioContext = originals.AudioContext;
      globalThis.AudioWorkletNode = originals.AudioWorkletNode;
      globalThis.MediaStream = originals.MediaStream;
    }
  });

  test('releases acquired resources for each initialization failure', async () => {
    // The stage matrix includes object-URL creation and revocation as well as
    // the later resource-acquisition boundaries.
    for (const stage of ['object-url', 'module', 'revoke', 'node', 'connect', 'resume'] as const) {
      const originals = {
        AudioContext: globalThis.AudioContext,
        AudioWorkletNode: globalThis.AudioWorkletNode,
        MediaStream: globalThis.MediaStream,
        createObjectURL: URL.createObjectURL,
        revokeObjectURL: URL.revokeObjectURL,
      };
      const released = { revoke: 0, source: 0, node: 0, port: 0, track: 0, context: 0 };
      const track = { enabled: true, stop: () => { released.track += 1; } } as unknown as MediaStreamTrack;
      class Context {
        sampleRate = 48_000;
        audioWorklet = { addModule: async () => { if (stage === 'module') throw new Error(stage); } };
        createMediaStreamSource() {
          return {
            connect: (target: unknown) => { if (stage === 'connect') throw new Error(stage); return target; },
            disconnect: () => { released.source += 1; },
          };
        }
        createMediaStreamDestination() { return { stream: new MediaStream([track]) }; }
        async resume() { if (stage === 'resume') throw new Error(stage); }
        async close() { released.context += 1; }
      }
      class Node {
        port = { onmessage: null, postMessage: () => {}, close: () => { released.port += 1; } };
        constructor() { if (stage === 'node') throw new Error(stage); }
        connect(target: unknown) { return target; }
        disconnect() { released.node += 1; }
      }
      try {
        globalThis.MediaStream = class {
          constructor(readonly tracks: MediaStreamTrack[]) {}
          getAudioTracks() { return this.tracks; }
        } as unknown as typeof MediaStream;
        globalThis.AudioContext = Context as unknown as typeof AudioContext;
        globalThis.AudioWorkletNode = Node as unknown as typeof AudioWorkletNode;
        URL.createObjectURL = () => {
          if (stage === 'object-url') throw new Error(stage);
          return 'blob:failure';
        };
        URL.revokeObjectURL = () => {
          released.revoke += 1;
          if (stage === 'revoke' || stage === 'module') throw new Error('revoke');
        };
        await expect(createLocalAudioPreRoll({} as MediaStreamTrack)).rejects.toThrow(stage);
        expect(released.context).toBe(1);
        expect(released.revoke).toBe(stage === 'object-url' ? 0 : 1);
        expect(released.source).toBe(1);
        expect(released.track).toBe(1);
        expect(released.node).toBe(stage === 'node' || stage === 'module' || stage === 'object-url' || stage === 'revoke' ? 0 : 1);
        expect(released.port).toBe(stage === 'node' || stage === 'module' || stage === 'object-url' || stage === 'revoke' ? 0 : 1);
      } finally {
        globalThis.AudioContext = originals.AudioContext;
        globalThis.AudioWorkletNode = originals.AudioWorkletNode;
        globalThis.MediaStream = originals.MediaStream;
        URL.createObjectURL = originals.createObjectURL;
        URL.revokeObjectURL = originals.revokeObjectURL;
      }
    }
  });

  test('continues normal destruction after cleanup failures and reports the first', async () => {
    const originals = {
      AudioContext: globalThis.AudioContext,
      AudioWorkletNode: globalThis.AudioWorkletNode,
      MediaStream: globalThis.MediaStream,
      createObjectURL: URL.createObjectURL,
      revokeObjectURL: URL.revokeObjectURL,
    };
    const calls = { source: 0, node: 0, port: 0, disable: 0, stop: 0, context: 0 };
    const generated = Object.defineProperties({}, {
      enabled: {
        get: () => true,
        set: () => { calls.disable += 1; throw new Error('disable'); },
      },
      stop: { value: () => { calls.stop += 1; throw new Error('stop'); } },
    }) as MediaStreamTrack;
    class Context {
      sampleRate = 48_000;
      audioWorklet = { addModule: async () => {} };
      createMediaStreamSource() {
        return {
          connect: (target: unknown) => target,
          disconnect: () => { calls.source += 1; throw new Error('source'); },
        };
      }
      createMediaStreamDestination() { return { stream: new MediaStream([generated]) }; }
      async resume() {}
      async close() { calls.context += 1; throw new Error('context'); }
    }
    class Node {
      port = {
        onmessage: null,
        postMessage: () => {},
        close: () => { calls.port += 1; throw new Error('port'); },
      };
      connect(target: unknown) { return target; }
      disconnect() { calls.node += 1; throw new Error('node'); }
    }
    try {
      globalThis.MediaStream = class {
        constructor(readonly tracks: MediaStreamTrack[]) {}
        getAudioTracks() { return this.tracks; }
      } as unknown as typeof MediaStream;
      globalThis.AudioContext = Context as unknown as typeof AudioContext;
      globalThis.AudioWorkletNode = Node as unknown as typeof AudioWorkletNode;
      URL.createObjectURL = () => 'blob:cleanup';
      URL.revokeObjectURL = () => {};
      const bridge = await createLocalAudioPreRoll({} as MediaStreamTrack);
      await expect(bridge.destroy()).rejects.toThrow('port');
      expect(calls).toEqual({ source: 1, node: 1, port: 1, disable: 1, stop: 1, context: 1 });
      await bridge.destroy();
    } finally {
      globalThis.AudioContext = originals.AudioContext;
      globalThis.AudioWorkletNode = originals.AudioWorkletNode;
      globalThis.MediaStream = originals.MediaStream;
      URL.createObjectURL = originals.createObjectURL;
      URL.revokeObjectURL = originals.revokeObjectURL;
    }
  });

  test('releases bridge-owned resources once without mutating the source', async () => {
    const originals = {
      AudioContext: globalThis.AudioContext,
      AudioWorkletNode: globalThis.AudioWorkletNode,
      MediaStream: globalThis.MediaStream,
      createObjectURL: URL.createObjectURL,
      revokeObjectURL: URL.revokeObjectURL,
    };
    let sourceStops = 0;
    let sourceDisconnects = 0;
    let nodeDisconnects = 0;
    let portCloses = 0;
    let trackStops = 0;
    let contextCloses = 0;
    const sourceTrack = {
      enabled: true,
      stop: () => { sourceStops += 1; },
    } as unknown as MediaStreamTrack;
    const generatedTrack = {
      enabled: true,
      stop: () => { trackStops += 1; },
    } as unknown as MediaStreamTrack;
    class Context {
      sampleRate = 48_000;
      audioWorklet = { addModule: async () => {} };
      createMediaStreamSource() {
        return {
          connect: (target: unknown) => target,
          disconnect: () => { sourceDisconnects += 1; },
        };
      }
      createMediaStreamDestination() {
        return { stream: new MediaStream([generatedTrack]) };
      }
      async resume() {}
      async close() { contextCloses += 1; }
    }
    class Node {
      port = { onmessage: null, postMessage: () => {}, close: () => { portCloses += 1; } };
      connect(target: unknown) { return target; }
      disconnect() { nodeDisconnects += 1; }
    }
    try {
      globalThis.MediaStream = class {
        constructor(readonly tracks: MediaStreamTrack[]) {}
        getAudioTracks() { return this.tracks; }
      } as unknown as typeof MediaStream;
      globalThis.AudioContext = Context as unknown as typeof AudioContext;
      globalThis.AudioWorkletNode = Node as unknown as typeof AudioWorkletNode;
      URL.createObjectURL = () => 'blob:owned';
      URL.revokeObjectURL = () => {};
      const bridge = await createLocalAudioPreRoll(sourceTrack);
      const pending = bridge.startManualTurn();
      await bridge.destroy();
      await pending;
      await bridge.destroy();
      await expect(bridge.startAutomaticTurn(0)).rejects.toThrow('destroyed');
      await expect(bridge.startManualTurn()).rejects.toThrow('destroyed');
      await expect(bridge.clear()).rejects.toThrow('destroyed');
      await expect(bridge.endTurn()).rejects.toThrow('destroyed');
      expect(sourceTrack.enabled).toBe(true);
      expect(sourceStops).toBe(0);
      expect(generatedTrack.enabled).toBe(false);
      expect([trackStops, sourceDisconnects, nodeDisconnects, portCloses, contextCloses]).toEqual([1, 1, 1, 1, 1]);
    } finally {
      globalThis.AudioContext = originals.AudioContext;
      globalThis.AudioWorkletNode = originals.AudioWorkletNode;
      globalThis.MediaStream = originals.MediaStream;
      URL.createObjectURL = originals.createObjectURL;
      URL.revokeObjectURL = originals.revokeObjectURL;
    }
  });
});
