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

export type GreetingInterruptionDebugCategory =
  | 'runtime-unavailable'
  | 'bridge-unavailable'
  | 'vad-unavailable'
  | 'automatic-start-failed'
  | 'manual-start-failed'
  | 'publication-replaced'
  | 'publication-replace-failed'
  | 'interruption-failed';

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

export interface ReplacePublicationArgs {
  readonly generation: number;
  readonly generated: MediaStreamTrack;
  readonly raw: MediaStreamTrack;
}

export interface GreetingInterruptionOptions {
  readonly config: ResolvedBrowserVadConfig;
  readonly gate: MicrophonePublicationGate;
  readonly generation: () => number;
  readonly loadRuntime?: () => Promise<Runtime>;
  readonly replacePublication?: (
    args: ReplacePublicationArgs,
  ) => Promise<'replaced' | 'stale' | 'failed'>;
  /** Test-only override. Production uses the 250 ms worklet acknowledgement limit. */
  readonly commandTimeoutMs?: number;
  readonly debug: (category: GreetingInterruptionDebugCategory) => void;
}

const COMMAND_ACK_TIMEOUT_MS = 250;

async function withAckTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('ack-timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function rawDescriptor(
  stream: MediaStream,
  rawTrack: MediaStreamTrack,
): PreparedGreetingMicrophone {
  return {
    rawStream: stream,
    rawTrack,
    track: rawTrack,
    generated: false,
    abandon: async () => {},
  };
}

/** Package-private owner of generated greeting publication and one-shot VAD. */
export class GreetingInterruption {
  readonly #options: GreetingInterruptionOptions;
  #runtime: Runtime | undefined;
  #bridge: Bridge | undefined;
  #rawStream: MediaStream | undefined;
  #rawTrack: MediaStreamTrack | undefined;
  #generation: number | undefined;
  #sender: RTCRtpSender | undefined;
  #operation: Operation | undefined;
  #prepareEpoch = 0;

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
    if (!this.#options.config.enabled) return rawDescriptor(stream, rawTrack);

    const generation = this.#options.generation();
    const prepareEpoch = this.#prepareEpoch;
    let runtime: Runtime;
    try {
      runtime = await (
        this.#options.loadRuntime ?? loadGreetingInterruptionRuntime
      )();
    } catch {
      this.#options.debug('runtime-unavailable');
      return rawDescriptor(stream, rawTrack);
    }
    if (
      generation !== this.#options.generation() ||
      prepareEpoch !== this.#prepareEpoch
    )
      return rawDescriptor(stream, rawTrack);

    let bridge: Bridge;
    try {
      bridge = await runtime.createLocalAudioPreRoll(rawTrack);
    } catch {
      this.#options.debug('bridge-unavailable');
      return rawDescriptor(stream, rawTrack);
    }
    if (
      generation !== this.#options.generation() ||
      prepareEpoch !== this.#prepareEpoch
    ) {
      await bridge.destroy().catch(() => {});
      return rawDescriptor(stream, rawTrack);
    }

    this.#runtime = runtime;
    this.#bridge = bridge;
    this.#rawStream = stream;
    this.#rawTrack = rawTrack;
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
          this.#rawTrack = undefined;
          this.#runtime = undefined;
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
    const rawTrack = this.#rawTrack;
    if (
      !bridge ||
      !rawStream ||
      !rawTrack ||
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
      rawTrack,
      config: this.#options.config,
      gate: this.#options.gate,
      generation: this.#generation,
      currentGeneration: this.#options.generation,
      isCurrent: () => this.#operation === operation,
      createVad: async (options) => runtime.createBrowserVad(options),
      stopPlayback,
      replacePublication:
        this.#options.replacePublication ?? (async () => 'failed'),
      dropBridge: async (owned) => {
        if (this.#bridge === owned) {
          this.#bridge = undefined;
          this.#rawStream = undefined;
          this.#rawTrack = undefined;
          this.#runtime = undefined;
          this.#sender = undefined;
        }
        await owned.destroy().catch(() => {});
      },
      commandTimeoutMs:
        this.#options.commandTimeoutMs ?? COMMAND_ACK_TIMEOUT_MS,
      debug: this.#options.debug,
    });
    this.#operation = operation;
    return operation;
  }

  async destroy(): Promise<void> {
    this.#prepareEpoch += 1;
    this.#operation?.disarm();
    this.#operation = undefined;
    const bridge = this.#bridge;
    this.#bridge = undefined;
    this.#rawStream = undefined;
    this.#rawTrack = undefined;
    this.#generation = undefined;
    this.#runtime = undefined;
    const sender = this.#sender;
    this.#sender = undefined;
    void sender;
    await bridge?.destroy().catch(() => {});
  }
}

type OperationOptions = {
  readonly bridge: Bridge;
  readonly rawStream: MediaStream;
  readonly rawTrack: MediaStreamTrack;
  readonly config: ResolvedBrowserVadConfig;
  readonly gate: MicrophonePublicationGate;
  readonly generation: number;
  readonly currentGeneration: () => number;
  readonly isCurrent: () => boolean;
  readonly createVad: Runtime['createBrowserVad'];
  readonly stopPlayback: () => void;
  readonly replacePublication: (
    args: ReplacePublicationArgs,
  ) => Promise<'replaced' | 'stale' | 'failed'>;
  readonly dropBridge: (bridge: Bridge) => Promise<void>;
  readonly commandTimeoutMs: number;
  readonly debug: (category: GreetingInterruptionDebugCategory) => void;
};

class Operation implements GreetingInterruptionOperation {
  readonly #options: OperationOptions;
  #lease: MicrophonePublicationLease | undefined;
  #rawLease: MicrophonePublicationLease | undefined;
  #armed = false;
  #armEpoch = 0;
  #accepted = false;
  #recovered = false;
  #settling: Promise<void> | undefined;
  #accepting: Promise<void> | undefined;
  #recovering: Promise<void> | undefined;
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
    if (this.#armed || this.#accepted || this.#recovered) return;
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
          if (this.#accepted || this.#recovered || !this.#options.isCurrent())
            return;
          this.#options.debug('vad-unavailable');
          await this.#recover('vad-unavailable');
        },
      });
      this.#vad = vad;
      if (this.#retireWhenReady || !this.#armed) await this.#retireVad();
    } catch {
      this.#options.debug('vad-unavailable');
      if (!this.#accepted && this.#options.isCurrent())
        await this.#recover('vad-unavailable');
    } finally {
      this.#setupFinished = true;
      if (this.#retireWhenReady) await this.#retireVad();
    }
  }

  #accept(armEpoch: number): Promise<void> {
    if (
      !this.#options.isCurrent() ||
      !this.#armed ||
      armEpoch !== this.#armEpoch ||
      this.#accepted ||
      this.#recovered ||
      this.#options.generation !== this.#options.currentGeneration()
    )
      return Promise.resolve();
    this.#accepted = true;
    const config = this.#options.config;
    this.#accepting ??= (async () => {
      this.#options.stopPlayback();
      this.#armed = false;
      this.#lease?.release();
      if (!config.enabled) {
        this.disarm();
        await this.#retireVad();
        return;
      }
      try {
        await withAckTimeout(
          this.#options.bridge.startAutomaticTurn(config.preRollMs),
          this.#options.commandTimeoutMs,
        );
        this.disarm();
        await this.#retireVad();
      } catch {
        this.#options.debug('automatic-start-failed');
        await this.#recover('automatic-start-failed');
      }
    })();
    return this.#accepting;
  }

  #recover(
    reason: Extract<
      GreetingInterruptionDebugCategory,
      'vad-unavailable' | 'automatic-start-failed' | 'manual-start-failed'
    >,
  ): Promise<void> {
    if (this.#recovered) return this.#recovering ?? Promise.resolve();
    this.#recovered = true;
    this.#recovering ??= (async () => {
      await Promise.resolve();
      this.disarm();
      if (!this.#accepted) this.#options.stopPlayback();
      this.#rawLease = this.#options.gate.acquire(
        this.#options.rawStream,
        this.#options.generation,
      );
      this.#options.bridge.track.enabled = false;
      const result = await this.#options.replacePublication({
        generation: this.#options.generation,
        generated: this.#options.bridge.track,
        raw: this.#options.rawTrack,
      });
      if (result === 'replaced') {
        this.#options.debug('publication-replaced');
        await this.#options.dropBridge(this.#options.bridge);
        if (this.#accepted || reason === 'manual-start-failed') {
          this.#rawLease.release();
          this.#options.gate.releaseCurrent();
        }
      } else if (result === 'failed') {
        this.#options.debug('publication-replace-failed');
      } else {
        await this.#options.dropBridge(this.#options.bridge);
      }
      if (this.#setupFinished) await this.#retireVad();
      else this.#retireWhenReady = true;
    })();
    return this.#recovering;
  }

  settle(): Promise<void> {
    this.#settling ??= (async () => {
      this.disarm();
      await this.#accepting;
      await this.#recovering;
      await this.#retireVad();
      if (this.#recovered) {
        this.#rawLease?.release();
        this.#lease?.release();
        this.#options.gate.releaseCurrent();
        return;
      }
      if (this.#accepted) return;
      try {
        await withAckTimeout(
          this.#options.bridge.startManualTurn(),
          this.#options.commandTimeoutMs,
        );
        this.#lease?.release();
      } catch {
        this.#options.debug('manual-start-failed');
        await this.#recover('manual-start-failed');
      }
    })();
    return this.#settling;
  }
}
