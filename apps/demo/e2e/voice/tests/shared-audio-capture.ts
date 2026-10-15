export type AssistantAudioActivity = {
  readonly activeMs: number;
  readonly silentTailMs: number;
  readonly currentFrame?: number;
  readonly lastActiveFrame?: number | null;
};

export type AudioCaptureSetupDiagnostics = {
  readonly stage: string;
  readonly errorName: string | null;
  readonly greetingPreparedFrame: number | null;
  readonly armedFrame: number | null;
  readonly recording: {
    readonly receivedBlocks: number;
    readonly retainedBlocks: number;
    readonly retainedFrames: number;
    readonly storageLimitReached: boolean;
    readonly missingBlocks: number;
    readonly missingBlockReasons: BrowserAudioTimelineSnapshot['missingBlockReasons'];
    readonly omittedFrameGapDetails: number;
  };
  readonly preparation: {
    readonly policyMs: number;
    readonly deadlineMs: number;
    readonly elapsedMs: number | null;
    readonly clockResets: number;
    readonly continuousFrames: number;
    readonly formatResets: number;
    readonly absentInputQuanta: number;
    readonly requestedFrame: number | null;
    readonly firstCapturedFrame: number | null;
    readonly timedOut: boolean;
  };
};

export type BrowserAudioTimelineSnapshot = {
  readonly setup?: AudioCaptureSetupDiagnostics;
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

export type SharedAudioCaptureOptions = {
  readonly assistantSource?: 'remote' | 'greeting';
  readonly microphoneSource?: 'app' | 'controlled-reference';
  readonly setupTimeoutMs?: number;
  readonly preparationTimeoutMs?: number;
};

export function installSharedAudioTimeline(
  configuration: SharedAudioCaptureOptions,
): Promise<void>;
export function installSharedAudioTimeline(): Promise<void>;
export async function installSharedAudioTimeline(
  configuration: SharedAudioCaptureOptions = {},
): Promise<void> {
  const options = configuration ?? {};
  const setupTimeoutMs = options.setupTimeoutMs ?? 5_000;
  const preparationTimeoutMs = options.preparationTimeoutMs ?? 5_000;
  const preparationMs = 100;
  if (!Number.isSafeInteger(setupTimeoutMs) || setupTimeoutMs < 1)
    throw new Error('Invalid audio setup deadline.');
  if (!Number.isSafeInteger(preparationTimeoutMs) || preparationTimeoutMs < 1)
    throw new Error('Invalid audio input preparation deadline.');
  const setup = {
    preparation: {
      policyMs: preparationMs,
      deadlineMs: preparationTimeoutMs,
      elapsedMs: null as number | null,
      clockResets: 0,
      continuousFrames: 0,
      formatResets: 0,
      absentInputQuanta: 0,
      requestedFrame: null as number | null,
      firstCapturedFrame: null as number | null,
      timedOut: false,
    },
    stage: 'idle',
    errorName: null as string | null,
    greetingPreparedFrame: null as number | null,
    armedFrame: null as number | null,
  };
  const target = window as Window & {
    __voiceGreetingAudio?: { captureStream(): MediaStream | null };
    __voiceReferenceMicrophone?: {
      acquire(
        native: MediaDevices['getUserMedia'],
        app: MediaStream,
      ): Promise<MediaStream>;
      dispose(): void;
    };
    __voiceAudioTimeline?: {
      waitForReady(): Promise<void>;
      snapshot(): Promise<BrowserAudioTimelineSnapshot>;
      mark(): Promise<number>;
      sampleFrame(): number | null;
      assistantMonitor(fromFrame: number): Promise<AssistantAudioActivity>;
      testAttachMicrophone(stream: MediaStream): Promise<void>;
      greetingCaptureReady(stream: MediaStream): boolean;
      diagnostics(): AudioCaptureSetupDiagnostics;
      testWorkletSource(): string;
      dispose?(): Promise<void>;
    };
    __voiceTestObserve?: (event: {
      readonly type: string;
      readonly source: string;
      readonly clock: number;
      readonly payload?: unknown;
    }) => Promise<void>;
  };
  if (target.__voiceAudioTimeline) return;

  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => {});
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
  let disposed = false;
  let context: AudioContext | undefined;
  let recorder: AudioWorkletNode | undefined;
  let graphPromise: Promise<void> | undefined;
  let microphoneSourceConnected = false;
  let microphoneTrack: MediaStreamTrack | undefined;
  let assistantSourceConnected = false;
  let assistantStream: MediaStream | undefined;
  let assistantAttachPromise: Promise<void> | undefined;
  let greetingBus: GainNode | undefined;
  let greetingSilence: ConstantSourceNode | undefined;
  let workletArmed = false;
  let preparationStartedAt: number | undefined;
  let preparationTimer: ReturnType<typeof setTimeout> | undefined;
  const pendingAcquisitions = new Set<Promise<MediaStream>>();
  const mutedState = new Map<HTMLMediaElement, boolean>();
  let captureArmed = false;
  let capturedSamples = 0;
  let receivedBlocks = 0;
  let storageLimitReached = false;
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
  const diagnostics = (): AudioCaptureSetupDiagnostics => ({
    ...setup,
    preparation: { ...setup.preparation },
    recording: {
      receivedBlocks,
      retainedBlocks: blocks.length,
      retainedFrames: capturedSamples,
      storageLimitReached,
      missingBlocks,
      missingBlockReasons: {
        ...missingBlockReasons,
        frameGapDetails: [...missingBlockReasons.frameGapDetails],
      },
      omittedFrameGapDetails:
        missingBlockReasons.frameGaps -
        missingBlockReasons.frameGapDetails.length,
    },
  });
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
  const reportFailure = (reason: string) => {
    if (problem) return;
    problem = new Error(reason);
    clearTimeout(preparationTimer);
    void target
      .__voiceTestObserve?.({
        type: 'audio-capture-failure',
        source: 'shared-audio-timeline',
        clock: performance.now(),
        payload: { reason },
      })
      .catch(() => {});
  };

  const workletSource = `
    class SharedTimelineRecorder extends AudioWorkletProcessor {
      constructor() {
        super();
        this.armed = false;
        this.armRequested = false;
        this.preparationCancelled = false;
        this.preparationFrames = 0;
        this.preparationQuanta = 0;
        this.preparationLastFrame = undefined;
        this.preparationMicChannels = undefined;
        this.preparationAssistantChannels = undefined;
        this.preparationClockResets = 0;
        this.preparationFormatResets = 0;
        this.preparationAbsentInputQuanta = 0;
        this.requestedFrame = null;
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
          if (data === 'arm' && !this.armRequested && !this.armed && !this.preparationCancelled) {
            this.armRequested = true;
            this.requestedFrame = currentFrame;
          }
          if (data === 'cancel-preparation' && !this.armed) this.preparationCancelled = true;
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
        for (let i = 0; i < frames; i++) {
          if (left && ${options.assistantSource !== 'greeting'}) left[i] = assistant[0]?.[i] ?? 0;
          if (right && ${options.assistantSource !== 'greeting'}) right[i] = assistant[1]?.[i] ?? assistant[0]?.[i] ?? 0;
        }
        if (!this.armed) {
          this.warmupQuanta++;
          if (this.warmupQuanta === 8) this.port.postMessage({ warmed: true });
          if (!this.armRequested || this.preparationCancelled) return true;
          const continuous = this.preparationLastFrame === undefined || currentFrame === this.preparationLastFrame;
          const valid = this.microphoneConnected && this.assistantConnected && microphone.length >= 1 && microphone.length <= 2 && assistant.length >= 1 && assistant.length <= 2 && microphone.every(channel => channel.length === frames) && assistant.every(channel => channel.length === frames);
          const sameFormat = this.preparationMicChannels === undefined || (microphone.length === this.preparationMicChannels && assistant.length === this.preparationAssistantChannels);
          if (!continuous) this.preparationClockResets++;
          if (!sameFormat) this.preparationFormatResets++;
          if (!valid) this.preparationAbsentInputQuanta++;
          if (!continuous || !sameFormat || !valid) this.preparationFrames = 0;
          this.preparationLastFrame = currentFrame + frames;
          this.preparationMicChannels = microphone.length;
          this.preparationAssistantChannels = assistant.length;
          this.preparationQuanta++;
          if (this.preparationQuanta % 32 === 0)
            this.port.postMessage({preparing: true, requestedFrame: this.requestedFrame, continuousFrames: this.preparationFrames, clockResets: this.preparationClockResets, formatResets: this.preparationFormatResets, absentInputQuanta: this.preparationAbsentInputQuanta});
          if (!valid || this.preparationFrames < sampleRate * ${preparationMs} / 1000) {
            if (valid) this.preparationFrames += frames;
            return true;
          }
          this.armed = true;
          this.port.postMessage({armed: true, frame: currentFrame, requestedFrame: this.requestedFrame, continuousFrames: this.preparationFrames, clockResets: this.preparationClockResets, formatResets: this.preparationFormatResets, absentInputQuanta: this.preparationAbsentInputQuanta});
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

          }
          if (assistantRight) {
            this.assistantRight[at] = assistantRight[i];

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

  const waitForSetup = async (operation: Promise<unknown>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new DOMException(
                  'Audio setup deadline exceeded',
                  'TimeoutError',
                ),
              ),
            setupTimeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  const ensureGraph = async () => {
    if (disposed) throw new Error('Shared audio timeline was disposed');
    if (problem) throw problem;
    if (recorder) return;
    if (graphPromise) return graphPromise;
    graphPromise = (async () => {
      try {
        setup.stage = 'construct-context';
        const audioContext = new AudioContext({
          sampleRate: 48_000,
          latencyHint: 'interactive',
        });
        context = audioContext;
        setup.stage = 'resume-context';
        await waitForSetup(audioContext.resume());
        if (disposed) throw new Error('Shared audio timeline was disposed');
        setup.stage = 'sample-rate';
        if (audioContext.sampleRate !== 48_000)
          throw new Error(
            `Shared audio clock sample rate is ${audioContext.sampleRate}, expected 48000`,
          );
        const module = URL.createObjectURL(
          new Blob([workletSource], { type: 'text/javascript' }),
        );
        try {
          setup.stage = 'load-worklet';
          await waitForSetup(audioContext.audioWorklet.addModule(module));
        } finally {
          URL.revokeObjectURL(module);
        }
        if (disposed) throw new Error('Shared audio timeline was disposed');
        setup.stage = 'construct-recorder';
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
          if (data.preparing) {
            if (problem || disposed || workletArmed) return;
            setup.preparation = {
              ...setup.preparation,
              requestedFrame: data.requestedFrame,
              continuousFrames: data.continuousFrames,
              clockResets: data.clockResets,
              formatResets: data.formatResets,
              absentInputQuanta: data.absentInputQuanta,
              elapsedMs:
                performance.now() - (preparationStartedAt ?? performance.now()),
            };
            return;
          }
          if (data.armed) {
            if (disposed) return;
            const elapsedMs =
              performance.now() - (preparationStartedAt ?? performance.now());
            setup.armedFrame = data.frame;
            setup.preparation = {
              ...setup.preparation,
              elapsedMs,
              requestedFrame: data.requestedFrame,
              firstCapturedFrame: data.frame,
              clockResets: data.clockResets,
              continuousFrames: data.continuousFrames,
              formatResets: data.formatResets,
              absentInputQuanta: data.absentInputQuanta,
            };
            if (problem) return;
            if (elapsedMs > preparationTimeoutMs) {
              failPreparation();
              return;
            }
            clearTimeout(preparationTimer);
            setup.stage = 'recording';
            workletArmed = true;
            resolveReady();
            void target
              .__voiceTestObserve?.({
                type: 'audio-capture-ready',
                source: 'shared-audio-timeline',
                clock: performance.now(),
                payload: { sampleRate: context?.sampleRate ?? 0 },
              })
              .catch(() => {});
            return;
          }
          if (typeof data.assistantMonitorResponse === 'number') {
            const resolveMonitor = assistantMonitorResolvers.get(
              data.assistantMonitorResponse,
            );
            if (resolveMonitor) {
              assistantMonitorResolvers.delete(data.assistantMonitorResponse);
              resolveMonitor({
                currentFrame: data.currentFrame,
                lastActiveFrame: data.lastAssistantActiveFrame,
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
          if (disposed) return;
          receivedBlocks++;
          const nextEnd = data.frame + data.length;
          if (expectedFrame !== undefined && data.frame !== expectedFrame) {
            missingBlocks++;
            missingBlockReasons.frameGaps++;
            if (!storageLimitReached)
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
          if (!storageLimitReached) {
            blocks.push(data);
            capturedSamples += data.length;
            if (capturedSamples > audioContext.sampleRate * 600) {
              storageLimitReached = true;
              reportFailure('capture-exceeded-ten-minute-limit');
            }
          }
        };
        setup.stage = 'connect-recorder';
        recorder.connect(audioContext.destination);
        setup.stage = 'warm-worklet';
        await waitForSetup(warmed);
        setup.stage = 'graph-ready';
        if (disposed) throw new Error('Shared audio timeline was disposed');
        if (microphoneSourceConnected)
          recorder.port.postMessage('microphone-connected');
        if (assistantSourceConnected)
          recorder.port.postMessage('assistant-connected');
      } catch (error) {
        const name =
          error instanceof Error || error instanceof DOMException
            ? error.name
            : 'UnknownError';
        setup.errorName = [
          'Error',
          'TypeError',
          'SyntaxError',
          'AbortError',
          'NotSupportedError',
          'NotAllowedError',
          'InvalidStateError',
          'SecurityError',
          'NetworkError',
          'TimeoutError',
        ].includes(name)
          ? name
          : 'UnknownError';
        reportFailure(
          disposed
            ? 'capture-disposed-during-initialization'
            : `audio-context-initialization-failed:${setup.stage}:${setup.errorName}`,
        );
        if (context && context.state !== 'closed')
          await waitForSetup(context.close()).catch(() => {});
        rejectReady(problem ?? new Error('Shared audio timeline failed'));
        throw problem ?? new Error('Shared audio timeline failed');
      }
    })();
    return graphPromise;
  };

  const failPreparation = () => {
    if (workletArmed || disposed || problem) return;
    setup.stage = 'settle-inputs';
    setup.errorName = 'TimeoutError';
    setup.preparation.timedOut = true;
    setup.preparation.elapsedMs =
      performance.now() - (preparationStartedAt ?? performance.now());
    recorder?.port.postMessage('cancel-preparation');
    reportFailure('audio-input-preparation-timeout');
    rejectReady(problem ?? new Error('Audio input preparation timed out'));
  };

  const readyIfAttached = () => {
    if (disposed) return;
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
      setup.stage = 'settle-inputs';
      preparationStartedAt = performance.now();
      preparationTimer = setTimeout(failPreparation, preparationTimeoutMs);
      recorder.port.postMessage('arm');
    }
  };

  const attachMicrophone = async (stream: MediaStream) => {
    if (disposed) return;
    const track = stream.getAudioTracks()[0];
    if (!track) {
      reportFailure('microphone-audio-track-unavailable');
      throw new Error('getUserMedia returned no audio track');
    }
    if (microphoneTrack && microphoneTrack !== track) {
      reportFailure('microphone-track-replaced-after-capture-attached');
      throw problem ?? new Error('Microphone track replacement failed');
    }
    try {
      await ensureGraph();
    } catch (error) {
      if (disposed) return;
      throw error;
    }
    if (disposed || microphoneSourceConnected) return;
    const audioContext = context;
    const worklet = recorder;
    if (!audioContext || !worklet)
      throw new Error('Shared microphone capture graph did not initialize');
    const greetingStream =
      options.assistantSource === 'greeting'
        ? target.__voiceGreetingAudio?.captureStream()
        : undefined;
    if (options.assistantSource === 'greeting' && !greetingStream) {
      reportFailure('greeting-stream-unprepared');
      const failure =
        problem ??
        new Error(
          'Greeting stream must be prepared by the unlock gesture before microphone capture.',
        );
      rejectReady(failure);
      throw failure;
    }
    const source = audioContext.createMediaStreamSource(
      new MediaStream([track]),
    );
    source.connect(worklet, 0, 0);
    microphoneTrack = track;
    microphoneSourceConnected = true;
    worklet.port.postMessage('microphone-connected');
    if (greetingStream) {
      greetingBus = audioContext.createGain();
      greetingBus.channelCount = 2;
      greetingBus.channelCountMode = 'explicit';
      greetingBus.connect(worklet, 0, 1);
      greetingSilence = audioContext.createConstantSource();
      greetingSilence.offset.value = 0;
      greetingSilence.connect(greetingBus);
      greetingSilence.start();
      const greetingSource =
        audioContext.createMediaStreamSource(greetingStream);
      greetingSource.connect(greetingBus);
      assistantStream = greetingStream;
      setup.greetingPreparedFrame = Math.round(
        audioContext.currentTime * audioContext.sampleRate,
      );
      assistantSourceConnected = true;
      worklet.port.postMessage('assistant-connected');
    }
    readyIfAttached();
    if (options.assistantSource === 'greeting') await ready;
  };

  const attachAssistant = (
    element: HTMLMediaElement,
    stream: MediaStream,
  ): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (assistantStream && assistantStream !== stream) {
      for (const [mutedElement, wasMuted] of mutedState)
        mutedElement.muted = wasMuted;
      reportFailure('assistant-stream-replaced-after-capture-attached');
      return Promise.reject(
        problem ?? new Error('Assistant stream replacement failed'),
      );
    }
    assistantStream ??= stream;
    if (assistantSourceConnected) return Promise.resolve();
    if (assistantAttachPromise) return assistantAttachPromise;
    assistantAttachPromise = (async () => {
      await ensureGraph();
      if (problem) throw problem;
      if (disposed || assistantSourceConnected) return;
      const audioContext = context;
      const worklet = recorder;
      if (!audioContext || !worklet)
        throw new Error('Shared assistant capture graph did not initialize');
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(worklet, 0, 1);
      mutedState.set(element, element.muted);
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
    const acquisition = originalGetUserMedia(...args).then(async (stream) => {
      if (!disposed) {
        if (options.microphoneSource === 'controlled-reference') {
          try {
            const reference = target.__voiceReferenceMicrophone;
            if (!reference)
              throw new Error('Controlled reference hook is unavailable.');
            const captured = await reference.acquire(
              originalGetUserMedia,
              stream,
            );
            if (!disposed) await attachMicrophone(captured);
          } catch {
            reportFailure('controlled-reference-unavailable');
            rejectReady(
              problem ?? new Error('Controlled reference is unavailable.'),
            );
          }
        } else await attachMicrophone(stream);
      }
      return stream;
    });
    pendingAcquisitions.add(acquisition);
    void acquisition.then(
      () => pendingAcquisitions.delete(acquisition),
      () => pendingAcquisitions.delete(acquisition),
    );
    return acquisition;
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
      options.assistantSource === 'greeting' ||
      !(this instanceof HTMLAudioElement) ||
      !(this.srcObject instanceof MediaStream)
    )
      return nativePlay.call(this);
    return attachAssistant(this, this.srcObject as MediaStream)
      .catch(() => {
        reportFailure('assistant-track-attachment-failed');
        const failure =
          problem ?? new Error('Assistant track attachment failed');
        rejectReady(failure);
        throw failure;
      })
      .then(() => nativePlay.call(this));
  };
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: srcObjectDescriptor.configurable,
    enumerable: srcObjectDescriptor.enumerable,
    get: srcObjectDescriptor.get,
    set(value: MediaProvider | null) {
      nativeSrcObjectSetter.call(this, value);
      if (
        options.assistantSource !== 'greeting' &&
        this instanceof HTMLAudioElement &&
        value instanceof MediaStream
      ) {
        void attachAssistant(this, value).catch((_error) => {
          reportFailure('assistant-track-attachment-failed');
          rejectReady(
            problem ?? new Error('Assistant track attachment failed'),
          );
        });
      }
    },
  });

  const waitForReady = () => {
    if (preparationStartedAt !== undefined) return ready;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (preparationStartedAt === undefined)
          reject(
            new Error(
              'Shared audio timeline readiness timed out before both tracks connected',
            ),
          );
      }, 1_000);
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
  };

  target.__voiceAudioTimeline = {
    waitForReady,
    testAttachMicrophone: attachMicrophone,
    greetingCaptureReady: (stream) =>
      options.assistantSource === 'greeting' &&
      !disposed &&
      !problem &&
      workletArmed &&
      assistantStream === stream,
    diagnostics,
    testWorkletSource: () => workletSource,
    sampleFrame: () =>
      workletArmed && !problem && context
        ? Math.round(context.currentTime * context.sampleRate)
        : null,
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
    async dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(preparationTimer);
      target.__voiceAudioTimeline = undefined;
      rejectReady(new Error('Shared audio timeline was disposed'));
      for (const [element, wasMuted] of mutedState) element.muted = wasMuted;
      mutedState.clear();
      Reflect.deleteProperty(navigator.mediaDevices, 'getUserMedia');
      HTMLMediaElement.prototype.play = nativePlay;
      Object.defineProperty(
        HTMLMediaElement.prototype,
        'srcObject',
        srcObjectDescriptor,
      );
      greetingSilence?.stop();
      if (options.microphoneSource === 'controlled-reference')
        target.__voiceReferenceMicrophone?.dispose();
      recorder?.disconnect();
      await Promise.race([
        Promise.allSettled([
          ...pendingAcquisitions,
          ...(graphPromise ? [graphPromise] : []),
        ]),
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 1_000);
          timer.unref?.();
        }),
      ]);
      if (context && context.state !== 'closed')
        await context.close().catch(() => {});
      markerResolvers.clear();
      assistantMonitorResolvers.clear();
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
        setup: diagnostics(),
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
