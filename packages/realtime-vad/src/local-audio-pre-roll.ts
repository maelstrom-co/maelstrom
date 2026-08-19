const PROCESSOR_NAME = 'maelstrom-local-audio-pre-roll';
const MAX_LOCAL_AUDIO_PRE_ROLL_MS = 500;
const WORKLET_ACK_TIMEOUT_MS = 250;
const END_ACK_BASE_TIMEOUT_MS = 500;
const END_ACK_PRE_ROLL_MULTIPLIER = 2;
const MAX_END_ACK_WAIT_BEFORE_FALLBACK_MS = 1_500;

/**
 * A browser-local audio publication bridge for one caller-owned source track.
 *
 * While closed it emits silence while retaining a bounded newest local tail.
 * Automatic turns publish that tail before later live samples; manual turns
 * discard it and publish live samples only. The caller owns `sourceTrack` and
 * must arrange transport publication and pause ordering. This bridge owns only
 * its generated `track` and Web Audio resources.
 */
export interface LocalAudioPreRoll {
  /**
   * The generated publication track, rather than the caller-owned source
   * track. The bridge disables and stops this track during `destroy()`.
   */
  readonly track: MediaStreamTrack;

  /**
   * Opens automatic publication after the worklet acknowledges selection of
   * the bounded newest local tail. The tail is emitted once, before live
   * samples. Values are clamped to 0–500 ms (non-finite values mean zero), and
   * a missing acknowledgement rejects after 250 ms.
   */
  startAutomaticTurn(preRollMs: number): Promise<void>;

  /**
   * Discards retained and queued samples, then opens live-only publication
   * once the worklet acknowledges within 250 ms. It rejects on timeout or
   * after destruction.
   */
  startManualTurn(): Promise<void>;

  /**
   * Discards retained and queued samples and returns to silent closed
   * buffering after an ID-scoped worklet acknowledgement within 250 ms. It
   * rejects on timeout or after destruction.
   */
  clear(): Promise<void>;

  /**
   * Stops accepting live automatic samples and resolves after already accepted
   * pre-roll drains, returning to silent closed buffering. Its acknowledgement
   * limit is `min(1500, 500 + 2 * clamp(activePreRollMs, 0, 500))` ms; it
   * rejects if that acknowledgement never arrives or after destruction.
   */
  endTurn(): Promise<void>;

  /**
   * Idempotently clears the worklet, settles pending lifecycle requests, and
   * releases bridge-owned Web Audio resources and the generated track. It
   * never disables or stops the caller-owned source track; later lifecycle
   * requests reject because the generation is destroyed.
   */
  destroy(): Promise<void>;
}

/**
 * Creates a provider-neutral browser bridge that buffers a bounded local tail
 * from `sourceTrack` while its generated publication track is closed and
 * silent. Publish `track` only after the transport is ready to receive an
 * automatic tail, because the caller owns transport ordering and the source
 * track throughout its lifetime. Lifecycle operations settle only after their
 * matching worklet acknowledgement (or their documented timeout); creation
 * rejects when Web Audio is unsupported or a generated audio track cannot be
 * established. `destroy()` releases only bridge-owned resources.
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
  let source: MediaStreamAudioSourceNode | undefined;
  let generatedTrack: MediaStreamTrack | undefined;
  let objectUrl: string | undefined;
  let node: AudioWorkletNode | undefined;
  let objectUrlRevoked = false;
  let sourceDisconnected = false;
  let nodeDisconnected = false;
  let portClosed = false;
  let generatedTrackReleased = false;
  let contextClosed = false;

  const revokeObjectUrl = () => {
    if (!objectUrl || objectUrlRevoked) return;
    objectUrlRevoked = true;
    const url = objectUrl;
    objectUrl = undefined;
    URL.revokeObjectURL(url);
  };

  /** Releases every acquired resource, retaining only the first normal teardown error. */
  const cleanup = async (constructionFailed: boolean): Promise<void> => {
    let cleanupError: unknown;
    const attempt = (release: () => void) => {
      try {
        release();
      } catch (error) {
        if (!constructionFailed && cleanupError === undefined)
          cleanupError = error;
      }
    };

    attempt(revokeObjectUrl);
    attempt(() => {
      if (node && !portClosed) {
        portClosed = true;
        node.port.close();
      }
    });
    attempt(() => {
      if (node && !nodeDisconnected) {
        nodeDisconnected = true;
        node.disconnect();
      }
    });
    attempt(() => {
      if (source && !sourceDisconnected) {
        sourceDisconnected = true;
        source.disconnect();
      }
    });
    const track = generatedTrack;
    if (track && !generatedTrackReleased) {
      generatedTrackReleased = true;
      attempt(() => {
        track.enabled = false;
      });
      attempt(() => {
        track.stop();
      });
    }
    if (!contextClosed) {
      contextClosed = true;
      try {
        await context.close();
      } catch (error) {
        if (!constructionFailed && cleanupError === undefined)
          cleanupError = error;
      }
    }
    if (cleanupError !== undefined) throw cleanupError;
  };

  try {
    source = context.createMediaStreamSource(new MediaStream([sourceTrack]));
    const destination = context.createMediaStreamDestination();
    generatedTrack = destination.stream.getAudioTracks()[0];
    if (!generatedTrack) throw new Error('AudioWorklet produced no audio track');

    const module = new Blob([AUDIO_WORKLET_SOURCE], {
      type: 'text/javascript',
    });
    objectUrl = URL.createObjectURL(module);
    await context.audioWorklet.addModule(objectUrl);
    revokeObjectUrl();

    const maxSamples = Math.ceil(
      (context.sampleRate * MAX_LOCAL_AUDIO_PRE_ROLL_MS) / 1000,
    );
    node = new AudioWorkletNode(context, PROCESSOR_NAME, {
      channelCount: 1,
      outputChannelCount: [1],
      processorOptions: { maxSamples },
    });
    source.connect(node).connect(destination);
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

    const clearProcessor = () => {
      try {
        node?.port.postMessage({ type: 'clear' });
      } catch {
        // Teardown and timeout recovery remain best-effort if the port closed.
      }
    };

    const request = (
      type: string,
      data: Record<string, number> = {},
      timeoutMs = WORKLET_ACK_TIMEOUT_MS,
    ): Promise<void> => {
      if (destroyed)
        return Promise.reject(new Error('Audio pre-roll generation destroyed'));
      const id = ++requestId;
      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          clearProcessor();
          reject(new Error('Audio pre-roll worklet request timed out'));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timeout });
        try {
          node?.port.postMessage({ type, id, ...data });
        } catch (error) {
          pending.delete(id);
          clearTimeout(timeout);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    };

    return {
      track: generatedTrack,
      startAutomaticTurn(preRollMs) {
        const boundedMs = clampPreRollMs(preRollMs);
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
      clear() {
        return request('clear').finally(() => {
          activePreRollMs = 0;
        });
      },
      endTurn() {
        return request('end', {}, endAckTimeoutMs(activePreRollMs)).finally(
          () => {
            activePreRollMs = 0;
          },
        );
      },
      async destroy() {
        if (destroyed) return;
        destroyed = true;
        clearProcessor();
        for (const pendingRequest of pending.values()) {
          clearTimeout(pendingRequest.timeout);
          pendingRequest.resolve();
        }
        pending.clear();
        await cleanup(false);
      },
    };
  } catch (error) {
    await cleanup(true);
    throw error;
  }
}

function clampPreRollMs(preRollMs: number): number {
  return Math.max(
    0,
    Math.min(
      MAX_LOCAL_AUDIO_PRE_ROLL_MS,
      Number.isFinite(preRollMs) ? preRollMs : 0,
    ),
  );
}

function endAckTimeoutMs(preRollMs: number): number {
  return Math.min(
    MAX_END_ACK_WAIT_BEFORE_FALLBACK_MS,
    END_ACK_BASE_TIMEOUT_MS +
      END_ACK_PRE_ROLL_MULTIPLIER * clampPreRollMs(preRollMs),
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
        if (data.id !== undefined) this.port.postMessage({ id: data.id });
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
