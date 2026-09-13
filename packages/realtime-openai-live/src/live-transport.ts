import type {
  AdapterAudioStreams,
  AdapterVoiceObservation,
  AdapterVoiceObservations,
  RealtimeAdapterEvent,
  RealtimeTransportAdapter,
} from '@maelstrom-co/realtime';
import {
  type LiveCommand,
  LiveExchangeRequestSchema,
  LiveExchangeResponseSchema,
  type LiveJson,
  type LiveServerEvent,
  LiveServerEventSchema,
  type LiveSessionConfig,
  type LiveSessionExchange,
  LiveTransportError,
} from '@maelstrom-co/realtime-protocol/openai-live';

/** Browser transport configuration. Factories must return exclusively owned resources. */
export interface LiveTransportOptions {
  /** Host-owned SDP exchange, usually an authenticated application route. */
  readonly exchange: LiveSessionExchange;
  /** Total startup bound including permission, ICE, HTTP, answer, and session.started; default 45 seconds. */
  readonly handshakeTimeoutMs?: number;
  /** Final-event drain bound after disconnect; default 15 seconds. */
  readonly closeTimeoutMs?: number;
  /** Trusted peer factory, useful for RTC configuration and isolated browser tests. */
  readonly createPeer?: () => RTCPeerConnection;
  /** Owned microphone acquisition, invoked synchronously by connect in the user gesture. */
  readonly getMicrophone?: () => Promise<MediaStream>;
  /** Owned audio player factory; playback can be retried through activateAudio. */
  readonly createAudio?: () => HTMLAudioElement;
}

/**
 * Retained lifecycle and final provider evidence for the latest explicit attempt.
 * Project diagnostic fields explicitly; the native final event can contain session configuration and provider content.
 */
export interface LiveTransportSnapshot {
  /** Local attempt identity. */
  readonly generation: number;
  /** Transport lifecycle independent of voice activity. */
  readonly state:
    | 'idle'
    | 'connecting'
    | 'connected'
    | 'closing'
    | 'closed'
    | 'error';
  /** Opaque provider session identity, when known. */
  readonly sessionId?: string;
  /** Latest cumulative voice duration, never a sum of updates. */
  readonly usageSeconds?: number;
  /** Distinct context utilization observation. */
  readonly contextUsageRatio?: number;
  /** Final usage only exists after a validated session.closed. */
  readonly finalUsageSeconds?: number;
  /** A lost transport or timeout leaves finalization incomplete. */
  readonly finalization: 'pending' | 'confirmed' | 'incomplete';
  /** Native final event, including reason and session configuration snapshot. */
  readonly closedEvent?: LiveServerEvent;
  /** Play acceptance does not prove audibility. Blocked playback needs a user action. */
  readonly playback: 'unavailable' | 'pending' | 'accepted' | 'blocked';
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
function object(
  value: LiveJson | undefined,
): value is { [key: string]: LiveJson } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function duration(value: LiveJson | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function attempt(action: () => void): void {
  try {
    action();
  } catch {
    /* Cleanup must continue through a failed resource. */
  }
}
function stop(stream?: MediaStream): void {
  for (const track of stream?.getTracks() ?? []) attempt(() => track.stop());
}

type Run = {
  id: number;
  abort: AbortController;
  ready: ReturnType<typeof deferred<void>>;
  ended: ReturnType<typeof deferred<void>>;
  started: boolean;
  answered: boolean;
  connected: boolean;
  closing: boolean;
  peer?: RTCPeerConnection;
  channel?: RTCDataChannel;
  mic?: MediaStream;
  playback?: MediaStream;
  audio?: HTMLAudioElement;
  startupTimer?: ReturnType<typeof setTimeout>;
  closeTimer?: ReturnType<typeof setTimeout>;
  disconnectedTimer?: ReturnType<typeof setTimeout>;
  releases: (() => void)[];
};

/**
 * Explicit WebRTC transport with L1 continuous observations. Managed function
 * execution and Maelstrom grounding belong to a separate integration. Finish
 * required Responses function outputs before calling disconnect: session.close
 * rejects later commands. This transport never reconnects or replays commands.
 */
export class OpenAILiveTransport
  implements RealtimeTransportAdapter<LiveSessionConfig>
{
  private run?: Run;
  private generation = 0;
  private snapshot: LiveTransportSnapshot = {
    generation: 0,
    state: 'idle',
    finalization: 'pending',
    playback: 'unavailable',
  };
  private readonly events = new Set<(event: RealtimeAdapterEvent) => void>();
  private readonly observers = new Set<
    (event: AdapterVoiceObservation) => void
  >();
  private readonly native = new Set<
    (event: LiveServerEvent, generation: number) => void
  >();
  private readonly changes = new Set<() => void>();
  private readonly handshakeMs: number;
  private readonly closeMs: number;

  /** Optional continuous evidence channel; transcript fragments never imply final turns. */
  readonly observations: AdapterVoiceObservations = {
    subscribe: (handler) => {
      this.observers.add(handler);
      return () => {
        this.observers.delete(handler);
      };
    },
  };

  /** Creates an inert transport. No media or billed session starts until connect. */
  constructor(private readonly options: LiveTransportOptions) {
    this.handshakeMs = options.handshakeTimeoutMs ?? 45_000;
    this.closeMs = options.closeTimeoutMs ?? 15_000;
    if (
      ![this.handshakeMs, this.closeMs].every(
        (value) =>
          Number.isFinite(value) && value > 0 && value <= 2_147_483_647,
      )
    )
      throw new LiveTransportError('invalid_timeout');
  }

  /** Returns detached lifecycle and final provider evidence; native fields cannot mutate transport state. */
  getSnapshot(): LiveTransportSnapshot {
    return structuredClone(this.snapshot);
  }
  /** Observes metadata changes, including autoplay recovery and finalization. */
  subscribe(handler: () => void): () => void {
    this.changes.add(handler);
    return () => {
      this.changes.delete(handler);
    };
  }
  /** Subscribes to legacy lifecycle events without fabricating turn activity. */
  on(handler: (event: RealtimeAdapterEvent) => void): () => void {
    this.events.add(handler);
    return () => {
      this.events.delete(handler);
    };
  }
  /** Subscribes to validated native envelopes. Nested Responses payloads require consumer validation. */
  onServerEvent(
    handler: (event: LiveServerEvent, generation: number) => void,
  ): () => void {
    this.native.add(handler);
    return () => {
      this.native.delete(handler);
    };
  }
  /** Returns current streams for metering; local participation disappears immediately on stop. */
  getAudioStreams(): AdapterAudioStreams {
    const run = this.run;
    return run && !run.closing ? { mic: run.mic, playback: run.playback } : {};
  }

  /** Starts microphone acquisition within the caller's user activation; concurrent starts share one attempt. */
  connect(session: LiveSessionConfig): Promise<void> {
    if (this.run)
      return this.run.closing
        ? Promise.reject(new LiveTransportError('closing'))
        : this.run.ready.promise;
    const run: Run = {
      id: ++this.generation,
      abort: new AbortController(),
      ready: deferred<void>(),
      ended: deferred<void>(),
      started: false,
      answered: false,
      connected: false,
      closing: false,
      releases: [],
    };
    this.run = run;
    this.snapshot = {
      generation: run.id,
      state: 'connecting',
      finalization: 'pending',
      playback: 'unavailable',
    };
    run.startupTimer = setTimeout(
      () => this.fail(run, new LiveTransportError('handshake_timeout')),
      this.handshakeMs,
    );
    void this.start(run, session).catch((error: unknown) => {
      if (this.current(run))
        this.fail(
          run,
          error instanceof LiveTransportError
            ? error
            : new LiveTransportError('startup_failed'),
        );
    });
    return run.ready.promise;
  }

  /** Retries output playback within a user action. Resolution means play acceptance, not audible delivery. */
  activateAudio(): Promise<void> {
    const run = this.run;
    if (!run || run.closing || !run.audio || !run.playback)
      return Promise.reject(
        new LiveTransportError('output_unavailable', { fatal: false }),
      );
    return this.play(run);
  }

  /** Submits one command only to the supplied generation. There is no queue, retry, or success acknowledgment. */
  send(command: LiveCommand, generation: number): void {
    const run = this.run;
    if (
      !run?.connected ||
      run.id !== generation ||
      run.closing ||
      run.channel?.readyState !== 'open'
    )
      throw new LiveTransportError('not_ready', { fatal: false });
    if (
      ![
        'response.create',
        'response.item.create',
        'session.thinking.append',
        'session.instructions.append',
        'session.commentary.append',
      ].includes(command.type)
    )
      throw new LiveTransportError('unsupported_command', { fatal: false });
    try {
      run.channel.send(JSON.stringify(command));
    } catch {
      this.fail(run, new LiveTransportError('send_failed'));
      throw new LiveTransportError('send_failed');
    }
  }

  /** Stops participation promptly, then drains session.closed for a bounded interval. Never waits for host tool work. */
  disconnect(): Promise<void> {
    const run = this.run;
    if (!run) return Promise.resolve();
    if (run.closing) return run.ended.promise;
    run.closing = true;
    clearTimeout(run.disconnectedTimer);
    stop(run.mic);
    attempt(() => run.audio?.pause());
    this.media({
      microphone: 'inactive',
      incomingAudio: 'inactive',
      userSpeech: 'unknown',
    });
    if (!this.current(run)) return run.ended.promise;
    if (!run.connected || run.channel?.readyState !== 'open') {
      this.finish(run);
      return run.ended.promise;
    }
    this.update({ state: 'closing' });
    if (!this.current(run)) return run.ended.promise;
    run.closeTimer = setTimeout(() => this.finish(run), this.closeMs);
    try {
      run.channel.send(
        JSON.stringify({
          type: 'session.close',
          event_id: crypto.randomUUID(),
        }),
      );
    } catch {
      this.finish(run);
    }
    return run.ended.promise;
  }

  private current(run: Run): boolean {
    return this.run === run && !run.abort.signal.aborted;
  }
  private assert(run: Run): void {
    if (!this.current(run) || run.closing)
      throw new LiveTransportError('aborted');
  }
  private async wait<T>(run: Run, promise: Promise<T>): Promise<T> {
    const interrupted = deferred<never>();
    const abort = () => interrupted.reject(new LiveTransportError('aborted'));
    run.abort.signal.addEventListener('abort', abort, { once: true });
    if (run.abort.signal.aborted) abort();
    try {
      const value = await Promise.race([promise, interrupted.promise]);
      this.assert(run);
      return value;
    } finally {
      run.abort.signal.removeEventListener('abort', abort);
    }
  }
  private listen(
    run: Run,
    target: EventTarget,
    type: string,
    handler: EventListener,
  ): void {
    target.addEventListener(type, handler);
    run.releases.push(() => target.removeEventListener(type, handler));
  }
  private async start(run: Run, session: LiveSessionConfig): Promise<void> {
    const peer = (this.options.createPeer ?? (() => new RTCPeerConnection()))();
    if (!this.current(run) || run.closing) {
      attempt(() => peer.close());
      this.assert(run);
    }
    run.peer = peer;
    const audio = (this.options.createAudio ?? (() => new Audio()))();
    if (!this.current(run) || run.closing) {
      attempt(() => audio.pause());
      attempt(() => {
        audio.srcObject = null;
      });
      this.assert(run);
    }
    run.audio = audio;
    const acquisition = (
      this.options.getMicrophone ??
      (() => navigator.mediaDevices.getUserMedia({ audio: true }))
    )();
    const mic = acquisition.then((stream) => {
      if (!this.current(run) || run.closing) stop(stream);
      else run.mic = stream;
      return stream;
    });
    void mic.catch(() => {});
    this.assert(run);
    this.emit({ type: 'state', state: 'connecting' });
    this.assert(run);
    this.update({});
    this.assert(run);
    this.listen(run, peer, 'track', ((event: RTCTrackEvent) => {
      if (!this.current(run) || run.closing) {
        attempt(() => event.track.stop());
        return;
      }
      if (event.track.kind !== 'audio') {
        attempt(() => event.track.stop());
        return;
      }
      run.playback ??= new MediaStream();
      run.playback.addTrack(event.track);
      if (run.audio) run.audio.srcObject = run.playback;
      const observe = () => {
        if (!this.current(run) || run.closing) return;
        this.media({
          incomingAudio: run.playback
            ?.getAudioTracks()
            .some((track) => track.readyState === 'live' && !track.muted)
            ? 'active'
            : 'inactive',
        });
      };
      for (const type of ['mute', 'unmute', 'ended'])
        this.listen(run, event.track, type, observe);
      observe();
      void this.play(run).catch(() => {});
    }) as EventListener);
    this.listen(run, peer, 'connectionstatechange', () => {
      if (!this.current(run)) return;
      if (['failed', 'closed'].includes(peer.connectionState)) {
        this.fail(run, new LiveTransportError('connection_lost'));
      } else if (peer.connectionState === 'disconnected') {
        if (!run.closing && run.disconnectedTimer === undefined)
          run.disconnectedTimer = setTimeout(() => {
            if (
              this.current(run) &&
              !run.closing &&
              peer.connectionState === 'disconnected'
            )
              this.fail(run, new LiveTransportError('connection_lost'));
          }, 5000);
      } else {
        clearTimeout(run.disconnectedTimer);
        run.disconnectedTimer = undefined;
      }
    });
    run.channel = peer.createDataChannel('oai-events');
    this.listen(run, run.channel, 'message', ((message: MessageEvent) => {
      if (!this.current(run)) return;
      try {
        if (typeof message.data !== 'string' || message.data.length > 1_048_576)
          throw new Error();
        const parsed = LiveServerEventSchema.safeParse(
          JSON.parse(message.data),
        );
        if (!parsed.success) throw new Error();
        this.receive(run, parsed.data as LiveServerEvent);
      } catch {
        this.fail(run, new LiveTransportError('invalid_event'));
      }
    }) as EventListener);
    for (const type of ['close', 'error'])
      this.listen(run, run.channel, type, () => {
        if (this.current(run))
          this.fail(run, new LiveTransportError('channel_lost'));
      });
    await this.wait(run, mic);
    this.assert(run);
    if (!run.mic) throw new LiveTransportError('microphone_unavailable');
    if (!run.mic.getAudioTracks().some((track) => track.readyState === 'live'))
      throw new LiveTransportError('microphone_unavailable');
    for (const track of run.mic.getAudioTracks()) {
      peer.addTrack(track, run.mic);
      this.listen(run, track, 'ended', () => {
        if (this.current(run) && !run.closing)
          this.fail(run, new LiveTransportError('microphone_ended'));
      });
      const observe = () => {
        if (this.current(run) && !run.closing)
          this.media({
            microphone: track.enabled && !track.muted ? 'active' : 'inactive',
          });
      };
      this.listen(run, track, 'mute', observe);
      this.listen(run, track, 'unmute', observe);
      observe();
    }
    this.assert(run);
    const offer = await this.wait(run, peer.createOffer());
    this.assert(run);
    await this.wait(run, peer.setLocalDescription(offer));
    this.assert(run);
    if (peer.iceGatheringState !== 'complete') {
      const gathered = deferred<void>();
      const check = () => {
        if (peer.iceGatheringState === 'complete') gathered.resolve();
      };
      this.listen(run, peer, 'icegatheringstatechange', check);
      check();
      await this.wait(run, gathered.promise);
      this.assert(run);
    }
    const request = LiveExchangeRequestSchema.safeParse({
      session,
      transport: { type: 'webrtc', sdp: peer.localDescription?.sdp },
    });
    if (!request.success) throw new LiveTransportError('invalid_offer');
    this.assert(run);
    const answer = await this.wait(
      run,
      this.options.exchange(request.data, run.abort.signal),
    );
    this.assert(run);
    const response = LiveExchangeResponseSchema.safeParse(answer);
    if (!response.success) throw new LiveTransportError('invalid_answer');
    this.update({ sessionId: response.data.session.id });
    this.assert(run);
    await this.wait(
      run,
      peer.setRemoteDescription({
        type: 'answer',
        sdp: response.data.transport.sdp,
      }),
    );
    this.assert(run);
    run.answered = true;
    this.ready(run);
  }
  private ready(run: Run): void {
    if (
      !this.current(run) ||
      run.closing ||
      run.connected ||
      !run.started ||
      !run.answered
    )
      return;
    run.connected = true;
    clearTimeout(run.startupTimer);
    this.update({ state: 'connected' });
    if (!this.current(run) || run.closing) return;
    this.emit({ type: 'state', state: 'connected' });
    if (!this.current(run) || run.closing) return;
    this.emit({ type: 'turn_mode', mode: 'automatic' });
    if (this.current(run) && !run.closing) run.ready.resolve();
  }
  private receive(run: Run, event: LiveServerEvent): void {
    if (event.type === 'session.started') {
      if (
        !object(event.session) ||
        typeof event.session.id !== 'string' ||
        event.session.id !== this.snapshot.sessionId
      )
        throw new Error();
      run.started = true;
      this.ready(run);
    } else if (event.type === 'session.closed') {
      if (
        !object(event.usage) ||
        !duration(event.usage.seconds) ||
        typeof event.reason !== 'string' ||
        !object(event.session) ||
        event.session.id !== this.snapshot.sessionId
      )
        throw new Error();
      this.snapshot = {
        ...this.snapshot,
        finalization: 'confirmed',
        finalUsageSeconds: event.usage.seconds,
        usageSeconds: event.usage.seconds,
        closedEvent: structuredClone(event),
      };
      run.closing = true;
      this.publishNative(run, event);
      this.finish(run);
      return;
    } else if (event.type === 'session.usage.updated') {
      if (!object(event.usage) || !duration(event.usage.seconds))
        throw new Error();
      const ratio = object(event.context_window)
        ? event.context_window.usage_ratio
        : undefined;
      if (ratio !== undefined && (!duration(ratio) || ratio > 1))
        throw new Error();
      this.update({
        usageSeconds: event.usage.seconds,
        ...(typeof ratio === 'number' ? { contextUsageRatio: ratio } : {}),
      });
    } else if (event.type === 'error') {
      if (
        !object(event.error) ||
        !(event.error.code === null || typeof event.error.code === 'string')
      )
        throw new Error();
      this.emit({
        type: 'error',
        error: new LiveTransportError('provider_rejected', {
          fatal: false,
          providerCode: event.error.code,
          clientEventId:
            typeof event.error.client_event_id === 'string'
              ? event.error.client_event_id
              : undefined,
        }),
      });
    } else if (
      !run.closing &&
      (event.type === 'session.input_transcript.delta' ||
        event.type === 'session.output_transcript.delta')
    ) {
      if (
        event.event_id.length > 256 ||
        typeof event.delta !== 'string' ||
        !duration(event.start_ms) ||
        !duration(event.end_ms) ||
        event.end_ms < event.start_ms
      )
        throw new Error();
      const role =
        event.type === 'session.input_transcript.delta' ? 'user' : 'assistant';
      this.mediaEvent({
        type: 'fragment',
        fragment: {
          id: event.event_id,
          role,
          speakerId: role,
          text: event.delta,
          startMs: event.start_ms,
          endMs: event.end_ms,
        },
      });
    }
    if (this.current(run)) this.publishNative(run, event);
  }
  private publishNative(run: Run, event: LiveServerEvent): void {
    const closing = run.closing;
    for (const handler of [...this.native]) {
      if (!this.current(run)) break;
      try {
        handler(structuredClone(event), run.id);
      } catch {
        this.callbackFailure(run.id, run, closing);
      }
    }
  }
  private async play(run: Run): Promise<void> {
    this.assert(run);
    this.update({ playback: 'pending' });
    this.assert(run);
    try {
      await this.wait(run, run.audio?.play() ?? Promise.reject());
      this.assert(run);
      this.update({ playback: 'accepted' });
    } catch {
      if (this.current(run) && !run.closing)
        this.update({ playback: 'blocked' });
      throw new LiveTransportError('playback_blocked', { fatal: false });
    }
  }
  private fail(run: Run, error: LiveTransportError): void {
    if (!this.current(run)) return;
    run.ready.reject(error);
    this.finish(run, true);
    if (this.generation === run.id) this.emit({ type: 'error', error });
  }
  private finish(run: Run, failed = false): void {
    if (!this.current(run)) return;
    this.run = undefined;
    run.abort.abort();
    clearTimeout(run.startupTimer);
    clearTimeout(run.closeTimer);
    clearTimeout(run.disconnectedTimer);
    for (const release of run.releases) attempt(release);
    stop(run.mic);
    stop(run.playback);
    attempt(() => run.audio?.pause());
    attempt(() => {
      if (run.audio) run.audio.srcObject = null;
    });
    attempt(() => run.channel?.close());
    attempt(() => run.peer?.close());
    run.ready.reject(new LiveTransportError('aborted'));
    run.ended.resolve();
    if (this.generation !== run.id) return;
    this.snapshot = {
      ...this.snapshot,
      state: failed ? 'error' : 'closed',
      finalization:
        this.snapshot.finalization === 'confirmed' ? 'confirmed' : 'incomplete',
      playback: 'unavailable',
    };
    this.media({
      microphone: 'inactive',
      incomingAudio: 'inactive',
      userSpeech: 'unknown',
    });
    if (this.generation !== run.id) return;
    this.emit({ type: 'state', state: failed ? 'error' : 'idle' });
    if (this.generation === run.id) this.update({});
  }
  private update(patch: Partial<LiveTransportSnapshot>): void {
    const generation = this.generation;
    const run = this.run;
    const closing = run?.closing;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const handler of [...this.changes]) {
      if (generation !== this.generation || run !== this.run) break;
      try {
        handler();
      } catch {
        this.callbackFailure(generation, run, closing);
      }
    }
  }
  private callbackFailure(
    generation: number,
    run: Run | undefined,
    closing: boolean | undefined,
  ): void {
    for (const handler of [...this.events]) {
      if (
        generation !== this.generation ||
        run !== this.run ||
        closing !== run?.closing
      )
        break;
      attempt(() =>
        handler({
          type: 'error',
          error: new LiveTransportError('listener_failed', { fatal: false }),
        }),
      );
    }
  }
  private emit(event: RealtimeAdapterEvent): void {
    const generation = this.generation;
    const run = this.run;
    const closing = run?.closing;
    for (const handler of [...this.events]) {
      if (
        generation !== this.generation ||
        run !== this.run ||
        closing !== run?.closing
      )
        break;
      try {
        handler(event);
      } catch {
        this.callbackFailure(generation, run, closing);
      }
    }
  }
  private media(
    media: Extract<AdapterVoiceObservation, { type: 'media' }>['media'],
  ): void {
    this.mediaEvent({ type: 'media', media });
  }
  private mediaEvent(event: AdapterVoiceObservation): void {
    const generation = this.generation;
    const run = this.run;
    const closing = run?.closing;
    for (const handler of [...this.observers]) {
      if (
        generation !== this.generation ||
        run !== this.run ||
        closing !== run?.closing
      )
        break;
      try {
        handler(structuredClone(event));
      } catch {
        this.callbackFailure(generation, run, closing);
      }
    }
  }
}
