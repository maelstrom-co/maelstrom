export type AssistantAudioActivity = {
  readonly activeMs: number;
  readonly silentTailMs: number;
};

export type BrowserAudioTimelineSnapshot = {
  readonly sampleRate: number;
  readonly inputChannels: number;
  readonly assistantChannels: number;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly blockCount: number;
  readonly missingBlocks: number;
  readonly playbackMarkers?: readonly number[];
  readonly missingBlockReasons: {
    readonly frameGaps: number;
    readonly inputFormatChanges: number;
    readonly assistantFormatChanges: number;
    readonly inputAbsentBlocks: number;
    readonly assistantAbsentBlocks: number;
    readonly frameGapDetails: readonly {
      readonly expectedFrame: number;
      readonly actualFrame: number;
      readonly deltaFrames: number;
    }[];
  };
  readonly inputWavBase64: string;
  readonly assistantWavBase64: string;
};

export async function installSharedAudioTimeline(): Promise<void> {
  const target = window as Window & {
    __voiceAudioTimeline?: {
      waitForReady(): Promise<void>;
      snapshot(): Promise<BrowserAudioTimelineSnapshot>;
      mark(): Promise<number>;
      assistantMonitor(fromFrame: number): Promise<AssistantAudioActivity>;
      testAttachMicrophone(stream: MediaStream): Promise<void>;
    };
  };
  if (target.__voiceAudioTimeline) return;

  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const blocks: {
    readonly frame: number;
    readonly length: number;
    readonly inputChannels: number;
    readonly assistantChannels: number;
    readonly inputLeft: Float32Array;
    readonly inputRight: Float32Array | null;
    readonly assistantLeft: Float32Array;
    readonly assistantRight: Float32Array | null;
    readonly inputPresent: boolean;
    readonly assistantPresent: boolean;
  }[] = [];
  let context: AudioContext | undefined;
  let recorder: AudioWorkletNode | undefined;
  let graphPromise: Promise<void> | undefined;
  let microphoneSourceConnected = false;
  let assistantSourceConnected = false;
  let assistantAttachPromise: Promise<void> | undefined;
  let captureArmed = false;
  let capturedSamples = 0;
  let problem: Error | undefined;
  let expectedFrame: number | undefined;
  let missingBlocks = 0;
  const missingBlockReasons = {
    frameGaps: 0,
    inputFormatChanges: 0,
    assistantFormatChanges: 0,
    inputAbsentBlocks: 0,
    assistantAbsentBlocks: 0,
    frameGapDetails: [] as {
      expectedFrame: number;
      actualFrame: number;
      deltaFrames: number;
    }[],
  };
  let inputChannelCount: number | undefined;
  let assistantChannelCount: number | undefined;
  let inputChannelWidth = 0;
  let assistantChannelWidth = 0;
  let flushResolver: (() => void) | undefined;
  let nextMarker = 0;
  const markerResolvers = new Map<number, (frame: number) => void>();
  let nextAssistantMonitorRequest = 0;
  const assistantMonitorResolvers = new Map<
    number,
    (activity: AssistantAudioActivity) => void
  >();
  const playbackMarkers: number[] = [];

  const workletSource = `
    class SharedTimelineRecorder extends AudioWorkletProcessor {
      constructor() {
        super();
        this.armed = false;
        this.warmupQuanta = 0;
        this.assistantConnected = false;
        this.microphoneConnected = false;
        this.capacity = sampleRate;
        this.lastQuantumEnd = undefined;
        this.assistantLevelEnergy = 0;
        this.assistantLevelFrames = 0;
        this.assistantActiveFrames = [];
        this.lastAssistantActiveFrame = undefined;
        this.monitorCurrentFrame = 0;
        this.reset();
        this.port.onmessage = ({data}) => {
          if (data === 'arm') this.armed = true;
          if (data === 'microphone-connected') this.microphoneConnected = true;
          if (data === 'assistant-connected') this.assistantConnected = true;
          if (data === 'flush') {
            this.flush();
            this.port.postMessage({flushed: true});
          }
          if (data && typeof data.assistantMonitorRequest === 'number') {
            let activeMs = 0;
            for (const frame of this.assistantActiveFrames)
              if (frame > data.fromFrame) activeMs += 10;
            this.port.postMessage({
              assistantMonitorResponse: data.assistantMonitorRequest,
              activeMs,
              currentFrame: this.monitorCurrentFrame,
              lastAssistantActiveFrame: this.lastAssistantActiveFrame ?? null,
            });
            return;
          }
          if (data && typeof data.marker === 'number')
            this.port.postMessage({marker: data.marker, frame: currentFrame});
        };
      }
      reset() {
        this.used = 0;
        this.startFrame = currentFrame;
        this.inputLeft = new Float32Array(this.capacity);
        this.inputRight = new Float32Array(this.capacity);
        this.assistantLeft = new Float32Array(this.capacity);
        this.assistantRight = new Float32Array(this.capacity);
        this.inputChannels = 0;
        this.assistantChannels = 0;
        this.inputFormatChanges = 0;
        this.assistantFormatChanges = 0;
        this.lastInputQuantumChannels = undefined;
        this.lastAssistantQuantumChannels = undefined;
        this.inputPresent = true;
        this.assistantPresent = true;
      }
      flush() {
        if (!this.used) return;
        const inputRight = this.inputChannels > 1 ? this.inputRight : null;
        const assistantRight = this.assistantChannels > 1 ? this.assistantRight : null;
        const block = {
          frame: this.startFrame,
          length: this.used,
          inputChannels: this.inputChannels,
          assistantChannels: this.assistantChannels,
          inputFormatChanges: this.inputFormatChanges,
          assistantFormatChanges: this.assistantFormatChanges,
          inputLeft: this.inputLeft,
          inputRight,
          assistantLeft: this.assistantLeft,
          assistantRight,
          inputPresent: this.inputPresent && this.microphoneConnected,
          assistantPresent: this.assistantPresent && this.assistantConnected,
        };
        const transfer = [this.inputLeft.buffer, this.assistantLeft.buffer];
        if (inputRight) transfer.push(inputRight.buffer);
        if (assistantRight) transfer.push(assistantRight.buffer);
        this.port.postMessage(block, transfer);
        this.reset();
      }
      process(inputs, outputs) {
        const microphone = inputs[0] || [];
        const assistant = inputs[1] || [];
        const output = outputs[0] || [];
        const left = output[0];
        const right = output[1];
        const frames = left?.length || 128;
        this.monitorCurrentFrame = currentFrame + frames;
        if (left) left.fill(0);
        if (right) right.fill(0);
        if (!this.armed) {
          this.warmupQuanta++;
          if (this.warmupQuanta === 8) this.port.postMessage({ warmed: true });
          return true;
        }
        const micLeft = microphone[0];
        const micRight = microphone[1];
        const assistantLeft = assistant[0];
        const assistantRight = assistant[1];
        if (
          this.lastQuantumEnd !== undefined &&
          currentFrame !== this.lastQuantumEnd &&
          this.used > 0
        )
          this.flush();
        this.lastQuantumEnd = currentFrame + frames;
        const micChannels = micLeft ? (micRight ? 2 : 1) : 0;
        const assistantChannels = assistantLeft
          ? assistantRight
            ? 2
            : 1
          : 0;
        if (this.used === 0) {
          this.inputChannels = micChannels;
          this.assistantChannels = assistantChannels;
          this.lastInputQuantumChannels = micChannels;
          this.lastAssistantQuantumChannels = assistantChannels;
        } else {
          if (micChannels !== this.lastInputQuantumChannels)
            this.inputFormatChanges++;
          if (assistantChannels !== this.lastAssistantQuantumChannels)
            this.assistantFormatChanges++;
          this.inputChannels = Math.max(this.inputChannels, micChannels);
          this.assistantChannels = Math.max(
            this.assistantChannels,
            assistantChannels,
          );
          this.lastInputQuantumChannels = micChannels;
          this.lastAssistantQuantumChannels = assistantChannels;
        }
        for (let i = 0; i < frames; i++) {
          if (this.used === 0) {
            this.startFrame = currentFrame + i;
            this.inputChannels = micChannels;
            this.assistantChannels = assistantChannels;
            this.inputFormatChanges = 0;
            this.assistantFormatChanges = 0;
            this.lastInputQuantumChannels = micChannels;
            this.lastAssistantQuantumChannels = assistantChannels;
            this.inputPresent = Boolean(micLeft) && this.microphoneConnected;
            this.assistantPresent = Boolean(assistantLeft) && this.assistantConnected;
          } else {
            if (!micLeft || !this.microphoneConnected) this.inputPresent = false;
            if (!assistantLeft || !this.assistantConnected) this.assistantPresent = false;
          }
          const at = this.used;
          if (micLeft) this.inputLeft[at] = micLeft[i];
          if (micRight) this.inputRight[at] = micRight[i];
          if (assistantLeft) {
            this.assistantLeft[at] = assistantLeft[i];
            if (left) left[i] = assistantLeft[i];
          }
          if (assistantRight) {
            this.assistantRight[at] = assistantRight[i];
            if (right) right[i] = assistantRight[i];
          } else if (assistantLeft && right) {
            right[i] = assistantLeft[i];
          }
          const assistantLeftSample = assistantLeft?.[i] ?? 0;
          const assistantRightSample =
            assistantRight?.[i] ?? assistantLeftSample;
          this.assistantLevelEnergy += assistantRight
            ? (assistantLeftSample * assistantLeftSample +
                assistantRightSample * assistantRightSample) /
              2
            : assistantLeftSample * assistantLeftSample;
          this.assistantLevelFrames++;
          if (this.assistantLevelFrames === 480) {
            if (Math.sqrt(this.assistantLevelEnergy / 480) > 0.01) {
              const activeFrame = currentFrame + i + 1;
              this.assistantActiveFrames.push(activeFrame);
              this.lastAssistantActiveFrame = activeFrame;
            }
            this.assistantLevelEnergy = 0;
            this.assistantLevelFrames = 0;
          }
          this.used++;
          if (this.used === this.capacity) this.flush();
        }
        return true;
      }
    }
    registerProcessor('maelstrom-shared-audio-timeline', SharedTimelineRecorder);
  `;

  const ensureGraph = async () => {
    if (problem) throw problem;
    if (recorder) return;
    if (graphPromise) return graphPromise;
    graphPromise = (async () => {
      try {
        const audioContext = new AudioContext({
          sampleRate: 48_000,
          latencyHint: 'interactive',
        });
        context = audioContext;
        await audioContext.resume();
        if (audioContext.sampleRate !== 48_000)
          throw new Error(
            `Shared audio clock sample rate is ${audioContext.sampleRate}, expected 48000`,
          );
        const module = URL.createObjectURL(
          new Blob([workletSource], { type: 'text/javascript' }),
        );
        try {
          await audioContext.audioWorklet.addModule(module);
        } finally {
          URL.revokeObjectURL(module);
        }
        recorder = new AudioWorkletNode(
          audioContext,
          'maelstrom-shared-audio-timeline',
          {
            numberOfInputs: 2,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            channelCount: 2,
            channelCountMode: 'max',
          },
        );
        let resolveWarmed!: () => void;
        const warmed = new Promise<void>((resolve) => {
          resolveWarmed = resolve;
        });
        recorder.port.onmessage = ({ data }) => {
          if (typeof data.assistantMonitorResponse === 'number') {
            const resolveMonitor = assistantMonitorResolvers.get(
              data.assistantMonitorResponse,
            );
            if (resolveMonitor) {
              assistantMonitorResolvers.delete(data.assistantMonitorResponse);
              resolveMonitor({
                activeMs: data.activeMs,
                silentTailMs:
                  data.lastAssistantActiveFrame === null
                    ? 0
                    : Math.max(
                        0,
                        data.currentFrame - data.lastAssistantActiveFrame,
                      ) / 48,
              });
            }
            return;
          }
          if (data.warmed) {
            resolveWarmed();
            return;
          }
          if (data.flushed) {
            flushResolver?.();
            flushResolver = undefined;
            return;
          }
          if (
            typeof data.marker === 'number' &&
            typeof data.frame === 'number'
          ) {
            const resolveMarker = markerResolvers.get(data.marker);
            if (resolveMarker) {
              markerResolvers.delete(data.marker);
              resolveMarker(data.frame);
            }
            return;
          }
          if (problem) return;
          const nextEnd = data.frame + data.length;
          if (expectedFrame !== undefined && data.frame !== expectedFrame) {
            missingBlocks++;
            missingBlockReasons.frameGaps++;
            missingBlockReasons.frameGapDetails.push({
              expectedFrame,
              actualFrame: data.frame,
              deltaFrames: data.frame - expectedFrame,
            });
          }
          expectedFrame = nextEnd;
          if (
            inputChannelCount !== undefined &&
            data.inputChannels !== inputChannelCount
          ) {
            missingBlocks++;
            missingBlockReasons.inputFormatChanges++;
          }
          if (
            assistantChannelCount !== undefined &&
            data.assistantChannels !== assistantChannelCount
          ) {
            missingBlocks++;
            missingBlockReasons.assistantFormatChanges++;
          }
          if (data.inputFormatChanges > 0) {
            missingBlocks += data.inputFormatChanges;
            missingBlockReasons.inputFormatChanges += data.inputFormatChanges;
          }
          if (data.assistantFormatChanges > 0) {
            missingBlocks += data.assistantFormatChanges;
            missingBlockReasons.assistantFormatChanges +=
              data.assistantFormatChanges;
          }
          if (!data.inputPresent) {
            missingBlocks++;
            missingBlockReasons.inputAbsentBlocks++;
          }
          if (!data.assistantPresent) {
            missingBlocks++;
            missingBlockReasons.assistantAbsentBlocks++;
          }
          inputChannelCount ??= data.inputChannels;
          assistantChannelCount ??= data.assistantChannels;
          inputChannelWidth = Math.max(inputChannelWidth, data.inputChannels);
          assistantChannelWidth = Math.max(
            assistantChannelWidth,
            data.assistantChannels,
          );
          blocks.push(data);
          capturedSamples += data.length;
          if (capturedSamples > audioContext.sampleRate * 600)
            problem = new Error(
              'Shared audio timeline exceeded its ten-minute limit',
            );
        };
        recorder.connect(audioContext.destination);
        await Promise.race([
          warmed,
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    'Shared AudioWorklet did not warm up before capture',
                  ),
                ),
              1_000,
            ),
          ),
        ]);
        if (microphoneSourceConnected)
          recorder.port.postMessage('microphone-connected');
        if (assistantSourceConnected)
          recorder.port.postMessage('assistant-connected');
      } catch (error) {
        problem = error instanceof Error ? error : new Error(String(error));
        rejectReady(problem);
        throw problem;
      }
    })();
    return graphPromise;
  };

  const readyIfAttached = () => {
    if (
      microphoneSourceConnected &&
      assistantSourceConnected &&
      !captureArmed
    ) {
      captureArmed = true;
      if (!recorder) {
        rejectReady(new Error('Shared AudioWorklet did not initialize'));
        return;
      }
      recorder.port.postMessage('arm');
      resolveReady();
    }
  };

  const attachMicrophone = async (stream: MediaStream) => {
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error('getUserMedia returned no audio track');
    await ensureGraph();
    if (microphoneSourceConnected) return;
    const audioContext = context;
    const worklet = recorder;
    if (!audioContext || !worklet)
      throw new Error('Shared microphone capture graph did not initialize');
    const source = audioContext.createMediaStreamSource(
      new MediaStream([track]),
    );
    source.connect(worklet, 0, 0);
    microphoneSourceConnected = true;
    worklet.port.postMessage('microphone-connected');
    readyIfAttached();
  };

  const attachAssistant = (
    element: HTMLMediaElement,
    stream: MediaStream,
  ): Promise<void> => {
    if (assistantSourceConnected) return Promise.resolve();
    if (assistantAttachPromise) return assistantAttachPromise;
    assistantAttachPromise = (async () => {
      await ensureGraph();
      if (assistantSourceConnected) return;
      const audioContext = context;
      const worklet = recorder;
      if (!audioContext || !worklet)
        throw new Error('Shared assistant capture graph did not initialize');
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(worklet, 0, 1);
      element.muted = true;
      assistantSourceConnected = true;
      worklet.port.postMessage('assistant-connected');
      readyIfAttached();
    })();
    return assistantAttachPromise;
  };

  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(
    navigator.mediaDevices,
  );
  navigator.mediaDevices.getUserMedia = async (...args) => {
    const stream = await originalGetUserMedia(...args);
    await attachMicrophone(stream);
    return stream;
  };

  const srcObjectDescriptor = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    'srcObject',
  );
  const nativeSrcObjectSetter = srcObjectDescriptor?.set;
  if (!srcObjectDescriptor?.get || !nativeSrcObjectSetter)
    throw new Error(
      'Cannot instrument HTMLMediaElement.srcObject for the shared audio clock',
    );
  const nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (
      !(this instanceof HTMLAudioElement) ||
      !(this.srcObject instanceof MediaStream)
    )
      return nativePlay.call(this);
    return attachAssistant(this, this.srcObject as MediaStream)
      .catch((error: unknown) => {
        problem = error instanceof Error ? error : new Error(String(error));
        rejectReady(problem);
      })
      .then(() => nativePlay.call(this));
  };
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: srcObjectDescriptor.configurable,
    enumerable: srcObjectDescriptor.enumerable,
    get: srcObjectDescriptor.get,
    set(value: MediaProvider | null) {
      nativeSrcObjectSetter.call(this, value);
      if (this instanceof HTMLAudioElement && value instanceof MediaStream) {
        void attachAssistant(this, value).catch((error) => {
          problem = error instanceof Error ? error : new Error(String(error));
          rejectReady(problem);
        });
      }
    },
  });

  const waitForReady = () =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              'Shared audio timeline readiness timed out before both tracks connected',
            ),
          ),
        1000,
      );
      ready.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });

  target.__voiceAudioTimeline = {
    waitForReady,
    testAttachMicrophone: attachMicrophone,
    async mark() {
      await waitForReady();
      const worklet = recorder;
      if (!worklet) throw new Error('Shared AudioWorklet is unavailable');
      const id = ++nextMarker;
      const frame = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => {
          markerResolvers.delete(id);
          reject(new Error('AudioWorklet playback marker timed out'));
        }, 1_000);
        markerResolvers.set(id, (value) => {
          clearTimeout(timer);
          resolve(value);
        });
        worklet.port.postMessage({ marker: id });
      });
      playbackMarkers.push(frame);
      return frame;
    },
    /** Measures the captured assistant WebRTC track, excluding physical output audio. */
    async assistantMonitor(fromFrame: number) {
      await waitForReady();
      if (!Number.isSafeInteger(fromFrame) || fromFrame < 0)
        throw new Error(
          'Assistant monitor frame must be a nonnegative integer',
        );
      const worklet = recorder;
      if (!worklet) throw new Error('Shared AudioWorklet is unavailable');
      const id = ++nextAssistantMonitorRequest;
      return new Promise<AssistantAudioActivity>((resolve, reject) => {
        const timer = setTimeout(() => {
          assistantMonitorResolvers.delete(id);
          reject(new Error('Assistant audio monitor query timed out'));
        }, 1_000);
        assistantMonitorResolvers.set(id, (activity) => {
          clearTimeout(timer);
          resolve(activity);
        });
        worklet.port.postMessage({
          assistantMonitorRequest: id,
          fromFrame,
        });
      });
    },
    async snapshot() {
      await waitForReady();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Shared audio timeline flush timed out')),
          1000,
        );
        flushResolver = () => {
          clearTimeout(timer);
          resolve();
        };
        const worklet = recorder;
        if (!worklet) {
          clearTimeout(timer);
          reject(new Error('Shared AudioWorklet is unavailable during flush'));
          return;
        }
        worklet.port.postMessage('flush');
      });
      if (problem) throw problem;
      const audioContext = context;
      const firstBlock = blocks[0];
      const lastBlock = blocks.at(-1);
      const inputChannels = inputChannelWidth || inputChannelCount || 1;
      const assistantChannels =
        assistantChannelWidth || assistantChannelCount || 1;
      if (
        !audioContext ||
        !firstBlock ||
        !lastBlock ||
        inputChannels === undefined ||
        assistantChannels === undefined
      )
        throw new Error('Shared audio timeline captured no complete blocks');
      const sampleRate = audioContext.sampleRate;
      const startFrame = firstBlock.frame;
      const endFrame = lastBlock.frame + lastBlock.length;
      return {
        sampleRate,
        inputChannels,
        assistantChannels,
        startFrame,
        endFrame,
        blockCount: blocks.length,
        missingBlocks,
        playbackMarkers: [...playbackMarkers],
        missingBlockReasons: { ...missingBlockReasons },
        inputWavBase64: encodeWav(
          blocks,
          'input',
          inputChannels,
          sampleRate,
          startFrame,
          endFrame,
        ),
        assistantWavBase64: encodeWav(
          blocks,
          'assistant',
          assistantChannels,
          sampleRate,
          startFrame,
          endFrame,
        ),
      };
    },
  };

  function encodeWav(
    captured: typeof blocks,
    kind: 'input' | 'assistant',
    channels: number,
    sampleRate: number,
    startFrame: number,
    endFrame: number,
  ): string {
    const samples = endFrame - startFrame;
    const data = new Uint8Array(44 + samples * channels * 2);
    const view = new DataView(data.buffer);
    const text = (offset: number, value: string) => {
      for (let i = 0; i < value.length; i++)
        data[offset + i] = value.charCodeAt(i);
    };
    text(0, 'RIFF');
    view.setUint32(4, data.length - 8, true);
    text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, samples * channels * 2, true);
    for (const block of captured) {
      const left = kind === 'input' ? block.inputLeft : block.assistantLeft;
      const right = kind === 'input' ? block.inputRight : block.assistantRight;
      const offset = block.frame - startFrame;
      for (let i = 0; i < block.length; i++) {
        for (let channel = 0; channel < channels; channel++) {
          const leftSample = left[i];
          if (leftSample === undefined)
            throw new Error('AudioWorklet block is missing a channel sample');
          const value = channel === 0 ? leftSample : (right?.[i] ?? leftSample);
          const pcm = Math.max(
            -32768,
            Math.min(32767, Math.round(value * 32768)),
          );
          view.setInt16(
            44 + ((offset + i) * channels + channel) * 2,
            pcm,
            true,
          );
        }
      }
    }
    let binary = '';
    for (let offset = 0; offset < data.length; offset += 0x8000)
      binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000));
    return btoa(binary);
  }
}
