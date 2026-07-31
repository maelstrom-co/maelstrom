const PROCESSOR_NAME = 'maelstrom-local-audio-pre-roll';

const MAX_LOCAL_AUDIO_PRE_ROLL_MS = 500;
const WORKLET_ACK_TIMEOUT_MS = 250;
const END_ACK_BASE_TIMEOUT_MS = 500;
const END_ACK_PRE_ROLL_MULTIPLIER = 2;
const MAX_END_ACK_WAIT_BEFORE_FALLBACK_MS = 1_500;

/** Browser audio generation owned by one connected LiveKit microphone. */
export interface LocalAudioPreRoll {
  /** Generated microphone track published to LiveKit instead of the raw mic. */
  readonly track: MediaStreamTrack;
  /** Replays the bounded local tail, or rejects when the worklet does not acknowledge. */
  startAutomaticTurn(preRollMs: number): Promise<void>;
  /** Discards the local tail, or rejects when the worklet does not acknowledge. */
  startManualTurn(): Promise<void>;
  /**
   * Resolves after drain. The acknowledgement bound is
   * `min(1500, 500 + 2 * clamp(preRollMs, 0, 500))`: 500ms with no pre-roll,
   * 1000ms at 250ms, and 1500ms at 500ms. Slow acknowledgements inside that
   * bound complete normally; a missing acknowledgement rejects as uncertain so
   * the adapter can pause upstream and retire automatic mode.
   */
  endTurn(): Promise<void>;
  /**
   * Idempotently clears audio, releases pending requests, stops the generated
   * track, and closes Web Audio. The caller-owned source track is not stopped.
   */
  destroy(): Promise<void>;
}

/**
 * Builds an AudioWorklet bridge that retains bounded raw mic audio locally and
 * exposes one generated track. Creation rejects when the required Web Audio
 * APIs cannot initialize, allowing the caller to fail closed to manual input.
 * The caller retains ownership of `sourceTrack`; `destroy()` stops only the
 * generated track and worklet resources. Lifecycle requests use bounded
 * acknowledgements so a stalled worklet cannot leave callers waiting forever.
 */
export async function createLocalAudioPreRoll(
  sourceTrack: MediaStreamTrack,
): Promise<LocalAudioPreRoll> {
  const AudioContextConstructor = globalThis.AudioContext;
  if (
    !AudioContextConstructor ||
    typeof globalThis.AudioWorkletNode === 'undefined'
  ) {
    throw new Error('AudioWorklet pre-roll is not supported in this browser');
  }

  const context = new AudioContextConstructor();
  let generatedTrack: MediaStreamTrack | undefined;
  let objectUrl: string | undefined;
  try {
    const source = context.createMediaStreamSource(
      new MediaStream([sourceTrack]),
    );
    const destination = context.createMediaStreamDestination();
    const module = new Blob([AUDIO_WORKLET_SOURCE], {
      type: 'text/javascript',
    });
    objectUrl = URL.createObjectURL(module);
    await context.audioWorklet.addModule(objectUrl);
    URL.revokeObjectURL(objectUrl);
    objectUrl = undefined;

    const maxSamples = Math.ceil(
      (context.sampleRate * MAX_LOCAL_AUDIO_PRE_ROLL_MS) / 1000,
    );
    const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
      channelCount: 1,
      outputChannelCount: [1],
      processorOptions: { maxSamples },
    });
    source.connect(node).connect(destination);
    generatedTrack = destination.stream.getAudioTracks()[0];
    if (!generatedTrack)
      throw new Error('AudioWorklet produced no audio track');
    await context.resume();

    let requestId = 0;
    let destroyed = false;
    let activePreRollMs = 0;
    const pending = new Map<
      number,
      {
        readonly resolve: () => void;
        readonly reject: (error: Error) => void;
        readonly timeout: ReturnType<typeof setTimeout>;
      }
    >();
    node.port.onmessage = (event: MessageEvent<{ readonly id?: number }>) => {
      const id = event.data.id;
      if (id === undefined) return;
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      clearTimeout(request.timeout);
      request.resolve();
    };
    /**
     * Sends one lifecycle request with an operation-specific acknowledgement
     * bound. A timeout clears processor state before rejection so a late
     * acknowledgement cannot affect the next turn.
     */
    const request = (
      type: string,
      data: Record<string, number> = {},
      timeoutMs = WORKLET_ACK_TIMEOUT_MS,
    ) => {
      if (destroyed)
        return Promise.reject(new Error('Audio pre-roll generation destroyed'));
      const id = ++requestId;
      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          node.port.postMessage({ type: 'clear' });
          reject(new Error('Audio pre-roll worklet request timed out'));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timeout });
        node.port.postMessage({ type, id, ...data });
      });
    };

    return {
      track: generatedTrack,
      startAutomaticTurn(preRollMs) {
        const boundedMs = Math.max(
          0,
          Math.min(
            MAX_LOCAL_AUDIO_PRE_ROLL_MS,
            Number.isFinite(preRollMs) ? preRollMs : 0,
          ),
        );
        return request('automatic-start', {
          samples: Math.round((context.sampleRate * boundedMs) / 1000),
        }).then(
          () => {
            activePreRollMs = boundedMs;
          },
          (error) => {
            activePreRollMs = 0;
            throw error;
          },
        );
      },
      startManualTurn() {
        return request('manual-start').finally(() => {
          activePreRollMs = 0;
        });
      },
      endTurn() {
        const timeoutMs = endAckTimeoutMs(activePreRollMs);
        return request('end', {}, timeoutMs).finally(() => {
          activePreRollMs = 0;
        });
      },
      async destroy() {
        if (destroyed) return;
        destroyed = true;
        node.port.postMessage({ type: 'clear' });
        for (const request of pending.values()) {
          clearTimeout(request.timeout);
          request.resolve();
        }
        pending.clear();
        node.port.close();
        source.disconnect();
        node.disconnect();
        if (generatedTrack) generatedTrack.enabled = false;
        generatedTrack?.stop();
        await context.close();
      },
    };
  } catch (error) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    generatedTrack?.stop();
    await context.close().catch(() => {});
    throw error;
  }
}

/**
 * Returns `min(1500, 500 + 2 * clamp(preRollMs, 0, 500))`. Non-finite and
 * negative inputs use the zero-pre-roll bound; oversized inputs use the hard
 * cap. This derived allowance contrasts with the fixed 250 ms lifecycle-request
 * timeout used by start operations.
 */
function endAckTimeoutMs(preRollMs: number): number {
  const boundedPreRollMs = Math.max(
    0,
    Math.min(
      MAX_LOCAL_AUDIO_PRE_ROLL_MS,
      Number.isFinite(preRollMs) ? preRollMs : 0,
    ),
  );
  return Math.min(
    MAX_END_ACK_WAIT_BEFORE_FALLBACK_MS,
    END_ACK_BASE_TIMEOUT_MS + END_ACK_PRE_ROLL_MULTIPLIER * boundedPreRollMs,
  );
}

const AUDIO_WORKLET_SOURCE = `
class MaelstromPreRollProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const maxSamples = options.processorOptions.maxSamples;
    this.ring = new Float32Array(maxSamples);
    this.ringStart = 0;
    this.ringLength = 0;
    this.queue = new Float32Array(maxSamples + 4096);
    this.queueStart = 0;
    this.queueLength = 0;
    this.mode = 'idle';
    this.endId = undefined;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'automatic-start') {
        const count = Math.max(0, Math.min(data.samples, this.ringLength));
        this.clearQueue();
        for (const sample of this.readRing().slice(this.ringLength - count)) {
          this.enqueue(sample);
        }
        this.clearRing();
        this.mode = 'automatic';
        this.port.postMessage({ id: data.id });
      } else if (data.type === 'manual-start') {
        this.clearQueue();
        this.clearRing();
        this.mode = 'manual';
        this.port.postMessage({ id: data.id });
      } else if (data.type === 'end') {
        if (this.mode !== 'automatic' || this.queueLength === 0) {
          this.mode = 'idle';
          this.clearQueue();
          this.port.postMessage({ id: data.id });
        } else {
          this.endId = data.id;
        }
      } else if (data.type === 'clear') {
        this.mode = 'idle';
        this.clearQueue();
        this.endId = undefined;
        this.clearRing();
      }
    };
  }
  readRing() {
    return Array.from({ length: this.ringLength }, (_, index) =>
      this.ring[(this.ringStart + index) % this.ring.length]);
  }
  clearRing() {
    this.ringStart = 0;
    this.ringLength = 0;
  }
  clearQueue() {
    this.queueStart = 0;
    this.queueLength = 0;
  }
  enqueue(sample) {
    const index = (this.queueStart + this.queueLength) % this.queue.length;
    this.queue[index] = sample;
    this.queueLength += 1;
  }
  dequeue() {
    const sample = this.queue[this.queueStart];
    this.queueStart = (this.queueStart + 1) % this.queue.length;
    this.queueLength -= 1;
    return sample;
  }
  retain(input) {
    for (const sample of input) {
      if (this.ringLength < this.ring.length) {
        this.ring[(this.ringStart + this.ringLength) % this.ring.length] = sample;
        this.ringLength += 1;
      } else {
        this.ring[this.ringStart] = sample;
        this.ringStart = (this.ringStart + 1) % this.ring.length;
      }
    }
  }
  process(inputs, outputs) {
    const input = inputs[0]?.[0] || new Float32Array(outputs[0][0].length);
    const output = outputs[0][0];
    output.fill(0);
    if (this.mode === 'idle') {
      this.retain(input);
      return true;
    }
    if (this.mode === 'manual') {
      output.set(input.subarray(0, output.length));
      return true;
    }
    if (this.endId === undefined) {
      for (const sample of input) this.enqueue(sample);
    }
    for (let index = 0; index < output.length && this.queueLength > 0; index += 1) {
      output[index] = this.dequeue();
    }
    if (this.endId !== undefined && this.queueLength === 0) {
      const id = this.endId;
      this.endId = undefined;
      this.mode = 'idle';
      this.port.postMessage({ id });
    }
    return true;
  }
}
registerProcessor('${PROCESSOR_NAME}', MaelstromPreRollProcessor);
`;
