import type { ResolvedBrowserVadConfig } from '@maelstrom-co/realtime-vad/config';
import {
  type GreetingInterruptionRuntime,
  loadGreetingInterruptionRuntime,
} from './greeting-interruption-runtime.js';
import type {
  MicrophonePublicationGate,
  MicrophonePublicationLease,
} from './microphone-publication-gate.js';

type Runtime = Pick<
  GreetingInterruptionRuntime,
  'createBrowserVad' | 'createLocalAudioPreRoll'
>;
type Bridge = Awaited<ReturnType<Runtime['createLocalAudioPreRoll']>>;
type Vad = Awaited<ReturnType<Runtime['createBrowserVad']>>;

export interface PreparedGreetingMicrophone {
  readonly rawStream: MediaStream;
  readonly rawTrack: MediaStreamTrack;
  readonly track: MediaStreamTrack;
  readonly generated: boolean;
  abandon(): Promise<void>;
}

export interface GreetingInterruptionOperation {
  arm(): void;
  disarm(): void;
  settle(): Promise<void>;
  readonly accepted: boolean;
}

export interface GreetingInterruptionOptions {
  readonly config: ResolvedBrowserVadConfig;
  readonly gate: MicrophonePublicationGate;
  readonly generation: () => number;
  readonly loadRuntime?: () => Promise<Runtime>;
  readonly debug: (category: 'interruption-failed') => void;
}

/** Package-private owner of generated greeting publication and one-shot VAD. */
export class GreetingInterruption {
  readonly #options: GreetingInterruptionOptions;
  #runtime: Runtime | undefined;
  #bridge: Bridge | undefined;
  #rawStream: MediaStream | undefined;
  #generation: number | undefined;
  // Retained for Phase 3's generation-fenced replaceTrack recovery.
  #sender: RTCRtpSender | undefined;
  #operation: Operation | undefined;

  constructor(options: GreetingInterruptionOptions) {
    this.#options = options;
  }

  async prepare(stream: MediaStream): Promise<PreparedGreetingMicrophone> {
    return this.prepareAndRemember(stream);
  }

  async prepareAndRemember(
    stream: MediaStream,
  ): Promise<PreparedGreetingMicrophone> {
    const rawTrack = stream.getAudioTracks()[0];
    if (!rawTrack) throw new Error('microphone stream has no audio track');
    if (!this.#options.config.enabled) {
      return {
        rawStream: stream,
        rawTrack,
        track: rawTrack,
        generated: false,
        abandon: async () => {},
      };
    }
    this.#runtime = await (
      this.#options.loadRuntime ?? loadGreetingInterruptionRuntime
    )();
    const bridge = await this.#runtime.createLocalAudioPreRoll(rawTrack);
    this.#bridge = bridge;
    this.#rawStream = stream;
    let abandoned = false;
    return {
      rawStream: stream,
      rawTrack,
      track: bridge.track,
      generated: true,
      abandon: async () => {
        if (abandoned) return;
        abandoned = true;
        if (this.#bridge === bridge) {
          this.#bridge = undefined;
          this.#rawStream = undefined;
        }
        await bridge.destroy().catch(() => {});
      },
    };
  }

  commit(
    prepared: PreparedGreetingMicrophone,
    sender: RTCRtpSender,
    generation: number,
  ): void {
    if (!prepared.generated || !this.#bridge) return;
    this.#generation = generation;
    this.#sender = sender;
  }

  begin(stopPlayback: () => void): GreetingInterruptionOperation | undefined {
    const bridge = this.#bridge;
    const rawStream = this.#rawStream;
    if (
      !bridge ||
      !rawStream ||
      this.#generation !== this.#options.generation()
    )
      return undefined;
    this.#operation?.disarm();
    const runtime = this.#runtime;
    if (!runtime) return undefined;
    let operation!: Operation;
    operation = new Operation({
      bridge,
      rawStream,
      config: this.#options.config,
      gate: this.#options.gate,
      generation: this.#generation,
      currentGeneration: this.#options.generation,
      isCurrent: () => this.#operation === operation,
      createVad: async (options) => runtime.createBrowserVad(options),
      stopPlayback,
      debug: this.#options.debug,
    });
    this.#operation = operation;
    return operation;
  }

  async destroy(): Promise<void> {
    this.#operation?.disarm();
    this.#operation = undefined;
    const bridge = this.#bridge;
    this.#bridge = undefined;
    this.#rawStream = undefined;
    this.#generation = undefined;
    // Sender identity is retained for the Phase 3 recovery seam until cleanup.
    const sender = this.#sender;
    this.#sender = undefined;
    void sender;
    await bridge?.destroy().catch(() => {});
  }
}

type OperationOptions = {
  readonly bridge: Bridge;
  readonly rawStream: MediaStream;
  readonly config: ResolvedBrowserVadConfig;
  readonly gate: MicrophonePublicationGate;
  readonly generation: number;
  readonly currentGeneration: () => number;
  readonly isCurrent: () => boolean;
  readonly createVad: Runtime['createBrowserVad'];
  readonly stopPlayback: () => void;
  readonly debug: (category: 'interruption-failed') => void;
};

class Operation implements GreetingInterruptionOperation {
  readonly #options: OperationOptions;
  #lease: MicrophonePublicationLease | undefined;
  #armed = false;
  #armEpoch = 0;
  #accepted = false;
  #settling: Promise<void> | undefined;
  #accepting: Promise<void> | undefined;
  #vad: Vad | undefined;
  #setup: Promise<void> | undefined;
  #setupFinished = false;
  #retiring: Promise<void> | undefined;
  #retireWhenReady = false;

  constructor(options: OperationOptions) {
    this.#options = options;
    const generatedStream = {
      getAudioTracks: () => [options.bridge.track],
    } as unknown as MediaStream;
    this.#lease = options.gate.acquire(generatedStream, options.generation);
  }

  get accepted(): boolean {
    return this.#accepted;
  }

  arm(): void {
    if (this.#armed || this.#accepted) return;
    this.#armed = true;
    const armEpoch = ++this.#armEpoch;
    this.#setup ??= this.#startVad(armEpoch);
  }

  disarm(): void {
    this.#armed = false;
    void this.#retireVad();
  }

  #retireVad(): Promise<void> {
    this.#retireWhenReady = true;
    const vad = this.#vad;
    if (!vad)
      return this.#setup && !this.#setupFinished
        ? this.#setup.then(() => this.#retireVad())
        : Promise.resolve();
    this.#retiring ??= vad.destroy().catch(() => {});
    return this.#retiring;
  }

  async #startVad(armEpoch: number): Promise<void> {
    if (!this.#options.config.enabled) return;
    try {
      const vad = await this.#options.createVad({
        stream: this.#options.rawStream,
        config: this.#options.config,
        startTurn: () => this.#accept(armEpoch),
        endTurn: async () => {},
        cancelTurn: async () => {},
        onFailure: async () => {
          this.disarm();
          this.#options.debug('interruption-failed');
        },
      });
      this.#vad = vad;
      if (this.#retireWhenReady || !this.#armed) await this.#retireVad();
    } catch {
      this.#options.debug('interruption-failed');
    } finally {
      this.#setupFinished = true;
    }
  }

  #accept(armEpoch: number): Promise<void> {
    if (
      !this.#options.isCurrent() ||
      !this.#armed ||
      armEpoch !== this.#armEpoch ||
      this.#accepted ||
      this.#options.generation !== this.#options.currentGeneration()
    )
      return Promise.resolve();
    this.#accepted = true;
    const config = this.#options.config;
    this.#accepting ??= (async () => {
      this.#options.stopPlayback();
      this.#armed = false;
      this.#lease?.release();
      if (config.enabled)
        await this.#options.bridge.startAutomaticTurn(config.preRollMs);
      this.disarm();
      await this.#retireVad();
    })();
    return this.#accepting;
  }

  settle(): Promise<void> {
    this.#settling ??= (async () => {
      this.disarm();
      await this.#accepting;
      await this.#retireVad();
      if (!this.#accepted) await this.#options.bridge.startManualTurn();
      this.#lease?.release();
    })();
    return this.#settling;
  }
}
