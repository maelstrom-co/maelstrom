export type GreetingAudioObservation = {
  readonly sourceCount: number;
  readonly failure: string | null;
  readonly startedAtFrame: number | null;
  readonly stoppedAtFrame: number | null;
  readonly stoppedEarly: boolean;
  readonly bufferDurationMs: number | null;
  readonly audibleDurationMs: number | null;
};

export type GreetingAudioWindow = Window & {
  __voiceAudioTimeline?: {
    greetingCaptureReady(stream: MediaStream): boolean;
    sampleFrame(): number | null;
  };
  __voiceGreetingAudio?: {
    snapshot(): GreetingAudioObservation;
    captureStream(): MediaStream | null;
    dispose(): void;
  };
};

export function installGreetingAudioTap(): void {
  const target = window as GreetingAudioWindow;
  if (target.__voiceGreetingAudio) return;
  const nativeConnect = AudioNode.prototype.connect;
  const nativeStart = AudioBufferSourceNode.prototype.start;
  const nativeStop = AudioBufferSourceNode.prototype.stop;
  const directSources = new WeakSet<AudioBufferSourceNode>();
  const sources = new Set<AudioBufferSourceNode>();
  let unlockContext: BaseAudioContext | undefined;
  let tap: MediaStreamAudioDestinationNode | undefined;
  let selected: AudioBufferSourceNode | undefined;
  let naturalEndTime: number | undefined;
  let audibleDurationMs: number | null = null;
  let startedAtFrame: number | null = null;
  let stoppedAtFrame: number | null = null;
  let stoppedEarly = false;
  let failure: string | null = null;
  const fail = (reason: string) => {
    failure ??= reason;
  };
  const connect = function (this: AudioNode, ...args: unknown[]) {
    const result = Reflect.apply(nativeConnect, this, args);
    if (
      !(this instanceof AudioBufferSourceNode) ||
      args[0] !== this.context.destination
    )
      return result;
    directSources.add(this);
    if (
      this.context !== unlockContext ||
      !this.buffer ||
      this.buffer.duration < 1 ||
      sources.has(this)
    )
      return result;
    if (!(this.context instanceof AudioContext)) {
      fail('unsupported-greeting-context');
      return result;
    }
    try {
      sources.add(this);
      if (sources.size !== 1) {
        fail('multiple-greeting-source-candidates');
        return result;
      }
      if (
        !tap ||
        !target.__voiceAudioTimeline?.greetingCaptureReady(tap.stream)
      )
        throw new Error(
          'Greeting capture was not prepared before source connection.',
        );
      Reflect.apply(nativeConnect, this, [tap]);
      selected = this;
    } catch {
      fail('greeting-tap-attachment-failed');
    }
    return result;
  } as typeof nativeConnect;
  const start: typeof nativeStart = function (
    this: AudioBufferSourceNode,
    ...args
  ) {
    const sourceStartTime = Math.max(args[0] ?? 0, this.context.currentTime);
    Reflect.apply(nativeStart, this, args);
    if (
      directSources.has(this) &&
      this.buffer?.length === 1 &&
      this.buffer.getChannelData(0)[0] === 0
    ) {
      if (unlockContext && unlockContext !== this.context)
        fail('multiple-unlock-contexts');
      unlockContext ??= this.context;
      if (!tap && unlockContext instanceof AudioContext) {
        try {
          tap = unlockContext.createMediaStreamDestination();
        } catch {
          fail('greeting-stream-preparation-failed');
        }
      }
    }
    if (this !== selected) return;
    const [when = 0, offset = 0, duration] = args;
    if (
      !this.buffer ||
      this.loop ||
      this.playbackRate.value !== 1 ||
      this.detune.value !== 0 ||
      offset !== 0 ||
      when > this.context.currentTime ||
      duration !== undefined
    ) {
      fail('unsupported-greeting-playback-shape');
      return;
    }
    const buffer = this.buffer;
    const channels = Array.from(
      { length: buffer.numberOfChannels },
      (_, index) => buffer.getChannelData(index),
    );
    let audibleEnd = buffer.length - 1;
    while (
      audibleEnd >= 0 &&
      !channels.some((channel) => Math.abs(channel?.[audibleEnd] ?? 0) >= 0.01)
    )
      audibleEnd--;
    if (audibleEnd < 0) {
      fail('greeting-source-silent');
      return;
    }
    audibleDurationMs = ((audibleEnd + 1) * 1000) / buffer.sampleRate;
    naturalEndTime = sourceStartTime + audibleDurationMs / 1000;
    startedAtFrame = target.__voiceAudioTimeline?.sampleFrame() ?? null;
    if (startedAtFrame === null) fail('greeting-start-clock-unavailable');
  };
  const stop: typeof nativeStop = function (
    this: AudioBufferSourceNode,
    ...args
  ) {
    Reflect.apply(nativeStop, this, args);
    if (this !== selected || stoppedAtFrame !== null) return;
    if ((args[0] ?? 0) > this.context.currentTime) {
      fail('scheduled-greeting-stop-unsupported');
      return;
    }
    stoppedAtFrame = target.__voiceAudioTimeline?.sampleFrame() ?? null;
    stoppedEarly =
      naturalEndTime !== undefined &&
      this.context.currentTime < naturalEndTime - 0.05;
    if (this.playbackRate.value !== 1 || this.detune.value !== 0 || this.loop)
      fail('greeting-playback-shape-changed');
    if (stoppedAtFrame === null) fail('greeting-stop-clock-unavailable');
  };
  AudioNode.prototype.connect = connect;
  AudioBufferSourceNode.prototype.start = start;
  AudioBufferSourceNode.prototype.stop = stop;
  target.__voiceGreetingAudio = {
    captureStream: () => tap?.stream ?? null,
    snapshot: () => ({
      sourceCount: sources.size,
      failure,
      startedAtFrame,
      stoppedAtFrame,
      stoppedEarly,
      bufferDurationMs: selected?.buffer
        ? selected.buffer.duration * 1000
        : null,
      audibleDurationMs,
    }),
    dispose() {
      if (AudioNode.prototype.connect === connect)
        AudioNode.prototype.connect = nativeConnect;
      if (AudioBufferSourceNode.prototype.start === start)
        AudioBufferSourceNode.prototype.start = nativeStart;
      if (AudioBufferSourceNode.prototype.stop === stop)
        AudioBufferSourceNode.prototype.stop = nativeStop;
      for (const source of sources) {
        try {
          if (tap) source.disconnect(tap);
        } catch {
          /* The player may already have disconnected its source. */
        }
      }
      for (const track of tap?.stream.getTracks() ?? []) track.stop();
      sources.clear();
      delete target.__voiceGreetingAudio;
    },
  };
}
