import type {
  TranscriptEntry,
  UIStructuralSnapshot,
  Unsubscribe,
  VoiceSession,
  VoiceSessionState,
} from '@maelstrom-co/client';
import { Logger, RequestInFlightError } from '@maelstrom-co/client';
import type {
  SessionId,
  SidechannelEvent,
  ToolCallId,
} from '@maelstrom-co/protocol';
import type {
  GreetingCoordinator,
  GreetingRunDisposition,
} from '../greeting-coordinator.js';
import { RealtimeVoiceError } from '../realtime-voice-error.js';
import { groundedDebounce } from './grounding-debounce.js';
import type {
  AdapterAudioStreams,
  AdapterTurnControl,
  RealtimeAdapterEvent,
  RealtimeGreetingAdapter,
  RealtimeProviderAdapter,
  RealtimeToolSpec,
  TurnMode,
  TurnModeEvent,
  UpdateUIToolResult,
} from './provider-adapter.types.js';
import { isRealtimeGreetingAdapter } from './provider-adapter.types.js';
import type {
  GreetingState,
  RealtimeInstance,
  RealtimeSessionOptions,
  SubmitIntentResult,
  SummarizeFn,
} from './realtime-session.types.js';

// Single source of truth for tool names — the `tools` array passed to the
// adapter and the dispatch table below are both keyed off this union, so a
// missing or mistyped case is a compile error instead of a silent
// "Unknown tool" at runtime.
const TOOL_NAMES = ['update_ui', 'get_ui_state', 'get_capabilities'] as const;
type ToolName = (typeof TOOL_NAMES)[number];

function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

const UPDATE_UI_TOOL = {
  name: 'update_ui',
  description:
    'Apply a natural-language UI intent (e.g. "show labs") and update the on-screen layout accordingly. The result is withheld until the change has rendered.',
  parametersJsonSchema: {
    type: 'object',
    properties: { intent: { type: 'string' } },
    required: ['intent'],
    additionalProperties: false,
  },
} satisfies RealtimeToolSpec<ToolName>;

const GET_UI_STATE_TOOL = {
  name: 'get_ui_state',
  description:
    'Read the current structural UI state (what is on screen and its layout) without changing anything.',
  parametersJsonSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
} satisfies RealtimeToolSpec<ToolName>;

const GET_CAPABILITIES_TOOL = {
  name: 'get_capabilities',
  description:
    'List every view this UI can show — each vessel, its purpose, its available variants, the actions that can transform it, and the concrete values each action parameter accepts. A parameter may report that some or all of its valid values are not listed — say so and ask the user to narrow it down; never claim no values exist or invent one. Call this when the user asks what you can do or show, and whenever they ask which items are available to act on.',
  parametersJsonSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
} satisfies RealtimeToolSpec<ToolName>;

const DEFAULT_INSTRUCTIONS =
  "You are the voice interface for a Maelstrom-powered UI. Call update_ui with a short natural-language instruction to change what's on screen, and get_ui_state to check what's currently shown. Call get_capabilities when the user asks what you can do or show, and also when they ask which items exist or which values you can act on — get_ui_state reports only layout and variants, so the available values live solely in get_capabilities. Check there before saying you do not know what is available. If it says some or all values aren't listed, tell the user and ask them to narrow it down — never say none exist or make one up. Only narrate a UI change after update_ui's result confirms it rendered.";

const DEFAULT_GROUNDING_DEBOUNCE_MS = 1000;

const BUSY_SUMMARY =
  'Still applying the previous change — try again in a moment.';

const APPLY_FAILED_SUMMARY = 'Something went wrong applying that change.';

const SUPERSEDED_SUMMARY = 'Superseded by a newer request.';

// isProcessing (guards RequestInFlightError) clears before the orchestrator's
// response has finished dispatching to the command queue, so a retry can
// lose the race and throw RequestInFlightError again even right after
// waitForIdle() resolves — bound the retries rather than looping forever.
const MAX_BARGE_IN_ATTEMPTS = 5;
const BARGE_IN_RETRY_DELAY_MS = 200;

// ~100 tokens — the design budget for a grounding push. injectGrounding is a
// realtime-voice sidechannel, not a chat turn; an unbounded summary would
// blow that budget silently since `summarize` is caller-injectable.
const GROUNDING_MAX_CHARS = 400;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A queued `update_ui` call awaiting retry once the in-flight request settles — latest-wins, so at most one exists at a time. */
interface QueuedIntent {
  readonly callId: ToolCallId;
  readonly intent: string;
  readonly resolve: (ok: boolean) => void;
}

function defaultSummarize(snapshot: UIStructuralSnapshot): string {
  const count = snapshot.instances.length;
  if (count === 0) return 'The screen is empty.';
  const parts = snapshot.instances
    .map((instance) => `${instance.vesselId} (${instance.variant})`)
    .join(', ');
  return `${count} vessel${count === 1 ? '' : 's'} on screen, ${snapshot.layoutMode} layout: ${parts}.`;
}

/**
 * Provider-agnostic realtime voice session core. Wires a
 * {@link RealtimeProviderAdapter}'s tool calls to a Maelstrom instance:
 * `update_ui` submits an intent and withholds its tool result until the
 * resulting render settles (speak-after-render); `get_ui_state` answers
 * immediately from a structural snapshot; `get_capabilities` answers
 * immediately from the vessel capability catalog; render-settle events push
 * a debounced, latest-wins grounding string; and every tool round-trip is
 * mirrored onto `onEvent` as {@link SidechannelEvent}s for observability.
 *
 * Concurrent `update_ui` calls (a model can emit a second while the first is
 * still being applied — the natural way a voice UI corrects itself mid-request)
 * use latest-wins queueing: if the instance rejects `submitIntent` with
 * `RequestInFlightError` because a prior intent is still applying, the new
 * call becomes the session's single pending queued intent instead of being
 * answered immediately. A call that was already queued when a newer one
 * arrives is answered right away with a "superseded" result and dropped —
 * only the most recent barge-in survives. Once the in-flight request settles,
 * the queued intent is retried; because a settled command queue doesn't
 * guarantee the orchestrator is ready to accept a new intent, the retry can
 * lose the race and is attempted a bounded number of times before the call is
 * answered as busy instead of retried forever. The raw exception never
 * reaches the adapter either way.
 *
 * @example
 * ```ts
 * const session = new RealtimeSession({
 *   adapter,
 *   instance: {
 *     submitIntent: (intent) =>
 *       orchestrator
 *         .processIntent(intent)
 *         .then((r) => ({ userMessage: r.userMessage })),
 *     waitForIdle: () => orchestrator.commandProcessor.waitForIdle(),
 *     getStructuralSnapshot: () => orchestrator.getStructuralSnapshot(),
 *     getCapabilitySnapshot: () => orchestrator.getCapabilitySnapshot(),
 *     onSettled: (cb) => orchestrator.onSettled(cb),
 *   },
 *   // …other options…
 * });
 * await session.connect();
 * ```
 */
export class RealtimeSession implements VoiceSession {
  readonly #adapter: RealtimeProviderAdapter;
  readonly #instance: RealtimeInstance;
  readonly #sessionId: SessionId;
  readonly #summarize: SummarizeFn;
  readonly #onEvent: (event: SidechannelEvent) => void;
  readonly #pushGrounding: ((snapshot: UIStructuralSnapshot) => void) & {
    cancel(): void;
  };
  readonly #logger: Logger;
  readonly #greeting:
    | {
        readonly text: string;
        readonly coordinator: GreetingCoordinator;
      }
    | undefined;
  #greetingAdapter: RealtimeGreetingAdapter | undefined;
  #greetingController: AbortController | undefined;
  #greetingState: GreetingState;

  #state: VoiceSessionState = 'idle';
  #turnMode: TurnMode = 'automatic';
  #turnModeError: unknown;
  readonly #stateHandlers = new Set<(s: VoiceSessionState) => void>();
  readonly #transcriptHandlers = new Set<(t: TranscriptEntry) => void>();
  readonly #turnModeHandlers = new Set<(event: TurnModeEvent) => void>();
  readonly #greetingStateHandlers = new Set<(state: GreetingState) => void>();
  #unsubscribeAdapter: Unsubscribe | undefined;
  #unsubscribeSettled: Unsubscribe | undefined;
  #queuedIntent: QueuedIntent | undefined;
  #bargeInLoopRunning = false;
  #groundingClampWarned = false;
  #lastError: unknown;
  // Bumped by disconnect() and at the start of every connect() attempt so a
  // connect() whose adapter.connect() is still in flight when disconnect()
  // runs can tell, once it resumes, that it's stale — without this a
  // disconnect() racing an in-flight connect() would have its cleanup
  // clobbered when the handshake resolves and the connect() call resumes
  // into 'connected' with a hot mic and zero consumers.
  #connectEpoch = 0;
  // The connection generation that most recently established a mode. A
  // successful generation with no adapter event uses the automatic fallback;
  // failed or stale generations never clear the previously retained mode.
  #turnModeEstablishedEpoch: number | undefined;

  readonly #toolHandlers: Record<
    ToolName,
    (callId: ToolCallId, argumentsJson: string) => Promise<boolean>
  > = {
    update_ui: (callId, argumentsJson) =>
      this.#handleUpdateUI(callId, argumentsJson),
    get_ui_state: (callId) => this.#handleGetUIState(callId),
    get_capabilities: (callId) => this.#handleGetCapabilities(callId),
  };

  constructor(options: RealtimeSessionOptions) {
    this.#adapter = options.adapter;
    this.#instance = options.instance;
    this.#sessionId = options.sessionId;
    this.#summarize = options.summarize ?? defaultSummarize;
    this.#onEvent = options.onEvent ?? (() => {});
    this.#logger = new Logger(options.debug ?? false, 'RealtimeSession');
    this.#greeting = options.greeting;
    this.#greetingState = this.#initialGreetingState();
    this.#pushGrounding = groundedDebounce((snapshot: UIStructuralSnapshot) => {
      this.#adapter.injectGrounding(
        this.#clampGrounding(this.#summarize(snapshot)),
      );
    }, options.groundingDebounceMs ?? DEFAULT_GROUNDING_DEBOUNCE_MS);
  }

  get state(): VoiceSessionState {
    return this.#state;
  }

  /**
   * Retained fixed-greeting presentation lifecycle for this shared session.
   * The value is initialized synchronously from coordinator proof and survives
   * session recreation when that proof is terminal. It does not mirror
   * provider activity, speech success, errors, transcripts, connection state,
   * or turn mode. Subscribe to `greeting_state` for later retained changes.
   */
  get greetingState(): GreetingState {
    return this.#greetingState;
  }

  /**
   * Retained turn-boundary mode, initially `automatic`. Speech-native adapters
   * establish a clean `automatic` mode after connect succeeds; adapters emit
   * `turn_mode` when they establish manual control or change mode. A failed
   * reconnect does not synthesize a clean transition or clear this value.
   */
  get turnMode(): TurnMode {
    return this.#turnMode;
  }

  /**
   * Diagnostic from an attempted automatic mode that degraded to manual.
   * Clean mode events and a successful speech-native reconnect clear it; a
   * failed reconnect preserves it. This value is for generic recovery guidance
   * only; consumers must not render it verbatim or serialize it into telemetry.
   */
  get turnModeError(): unknown {
    return this.#turnModeError;
  }

  /**
   * Current adapter-owned manual turn control. It is exposed only after the
   * adapter establishes manual mode and is read dynamically so adapter
   * degradation or teardown can replace or remove the control safely.
   */
  get turnControl(): AdapterTurnControl | undefined {
    return this.#turnMode === 'manual' ? this.#adapter.turnControl : undefined;
  }

  /**
   * The failure behind the most recent `error` state, if any. Cleared at the
   * start of the next `connect()` attempt, but preserved by explicit
   * `disconnect()` even after that method returns the public state to `idle`.
   * Typed failures are `RealtimeVoiceError` — switch on `.code` for recovery
   * UX.
   */
  get lastError(): unknown {
    return this.#lastError;
  }

  /**
   * Opens one provider connection. Re-entry from a live state is a no-op. A
   * successful connection that emitted no `turn_mode` establishes clean
   * automatic mode; a failed or stale attempt never synthesizes that fallback
   * and rejects with the adapter failure. An eligible configured greeting moves
   * to `preparing` synchronously before the provider handshake; retained
   * terminal proof leaves it `settled` and skips greeting work. The connection
   * generation owns both the greeting and `connecting` notifications: a
   * synchronous disconnect from either notification stops before audio
   * activation, adapter subscription, or provider connect. Audio activation
   * still occurs synchronously inside this call, before the first await.
   */
  async connect(): Promise<void> {
    // Re-entry guard: connect() is only meaningful from a dormant session.
    // From any live state (connecting/connected and the derived voice-activity
    // states) a second connect() would stack a second set of subscriptions on
    // top of the first's (only the last unsubscribe would ever be reachable),
    // so only idle or error may (re)connect.
    if (this.#state !== 'idle' && this.#state !== 'error') return;

    const epoch = ++this.#connectEpoch;
    this.#lastError = undefined;
    let greetingController: AbortController | undefined;

    if (this.#greeting) {
      if (!isRealtimeGreetingAdapter(this.#adapter)) {
        this.#lastError = new RealtimeVoiceError(
          'GREETING_ADAPTER_UNSUPPORTED',
          'greeting configured but the adapter does not implement RealtimeGreetingAdapter',
        );
        this.#setState('error');
        throw this.#lastError;
      }
      this.#greetingAdapter = this.#adapter;
      greetingController = new AbortController();
      this.#greetingController = greetingController;
      const snapshot = this.#greeting.coordinator.getSnapshot(this.#sessionId);
      if (snapshot.lifecycle === 'terminal') {
        this.#setGreetingState('settled');
      } else {
        this.#setGreetingState('preparing');
      }
      if (epoch !== this.#connectEpoch) return;
    }

    this.#setState('connecting');
    if (epoch !== this.#connectEpoch) return;

    try {
      // Still inside the initiating user gesture: no await has occurred, so the
      // unlock begins synchronously after re-entrant notifications are fenced.
      this.#greetingAdapter?.activateAudio();
      this.#unsubscribeAdapter = this.#adapter.on((event) => {
        this.#handleAdapterEvent(event);
      });
      await this.#adapter.connect({
        tools: [UPDATE_UI_TOOL, GET_UI_STATE_TOOL, GET_CAPABILITIES_TOOL],
        instructions: DEFAULT_INSTRUCTIONS,
      });
    } catch (error) {
      // A disconnect() that raced this attempt already reset state/cleanup —
      // don't stomp its 'idle' back to 'error'.
      if (epoch === this.#connectEpoch) {
        this.#cleanupConnection();
        this.#resetGreetingAfterConnectionEnd();
        this.#lastError = error;
        this.#setState('error');
      }
      throw error;
    }
    if (epoch !== this.#connectEpoch) {
      // disconnect() ran while adapter.connect() was still in flight — the
      // handshake succeeded, but nothing is listening for it anymore. Tear
      // the now-live adapter back down instead of resurrecting the session
      // into 'connected' with a hot mic and zero consumers.
      this.#cleanupConnection();
      void this.#adapter.disconnect().catch(() => {});
      return;
    }
    if (this.#turnModeEstablishedEpoch !== epoch) {
      this.#setTurnMode({ type: 'turn_mode', mode: 'automatic' });
    }
    // Grounding only makes sense once the data channel is actually up — a UI
    // settle mid-handshake would otherwise schedule a debounced push that
    // fires against a still-closed channel.
    this.#unsubscribeSettled = this.#instance.onSettled(() => {
      this.#pushGrounding(this.#instance.getStructuralSnapshot());
    });
    this.#setState('connected');

    if (
      this.#greeting &&
      greetingController &&
      this.#greetingState === 'preparing'
    ) {
      void this.#runGreetingGeneration(greetingController, epoch);
    }
  }

  /**
   * Invalidates connection ownership and removes local subscriptions and
   * greeting work before awaiting provider cleanup. Whether provider cleanup
   * resolves or rejects, coordinator proof restores the greeting to retryable
   * `pending` or terminal `settled`, and the public state becomes `idle`.
   * `lastError` is preserved, and any provider rejection is rethrown unchanged.
   */
  async disconnect(): Promise<void> {
    this.#connectEpoch++;
    this.#cleanupConnection();
    try {
      await this.#adapter.disconnect();
    } finally {
      this.#resetGreetingAfterConnectionEnd();
      this.#setState('idle');
    }
  }

  /**
   * Live audio streams for UI metering (voice orbs, level meters). Delegates
   * to the provider adapter; see `AdapterAudioStreams` for absence semantics.
   */
  getAudioStreams(): AdapterAudioStreams {
    return this.#adapter.getAudioStreams();
  }

  #cleanupConnection(): void {
    this.#unsubscribeAdapter?.();
    this.#unsubscribeSettled?.();
    this.#unsubscribeAdapter = undefined;
    this.#unsubscribeSettled = undefined;
    this.#pushGrounding.cancel();
    this.#greetingController?.abort();
    this.#greetingController = undefined;
    // Dropped silently, not answered: the adapter this call would have
    // replied on is going away too. The retry loop (if any is mid-wait)
    // notices the identity mismatch on its next wake and stops on its own.
    // We can't sendToolResult — the adapter is going away — but the local
    // promise still must settle, or any awaiter of it hangs forever; resolve
    // it `false` before clearing.
    this.#queuedIntent?.resolve(false);
    this.#queuedIntent = undefined;
  }

  /** Applies a coordinator result only while its controller and epoch still own the connection. */
  async #runGreetingGeneration(
    controller: AbortController,
    epoch: number,
  ): Promise<void> {
    if (!this.#greeting || !this.#greetingAdapter) return;
    const disposition = await this.#greeting.coordinator.run({
      sessionId: this.#sessionId,
      text: this.#greeting.text,
      instance: this.#instance,
      adapter: this.#greetingAdapter,
      signal: controller.signal,
      emitTranscript: (text) => this.#emitGreetingTranscript(text),
    });
    if (
      epoch !== this.#connectEpoch ||
      controller !== this.#greetingController ||
      disposition === 'stale'
    )
      return;
    this.#applyGreetingDisposition(disposition);
  }

  /** Derives the constructor-visible state without adopting or running coordinator work. */
  #initialGreetingState(): GreetingState {
    if (!this.#greeting) return 'not_configured';
    return this.#greeting.coordinator.getSnapshot(this.#sessionId).lifecycle ===
      'terminal'
      ? 'settled'
      : 'pending';
  }

  /** Retains the current generation's retryable or settled presentation result. */
  #applyGreetingDisposition(disposition: GreetingRunDisposition): void {
    if (disposition === 'aborted') {
      this.#setGreetingState('pending');
      return;
    }
    if (disposition === 'failed') {
      this.#logger.warn('greeting generation failed');
    }
    this.#setGreetingState('settled');
  }

  /** Restores retryable or terminal dormant state from durable coordinator proof after any teardown outcome. */
  #resetGreetingAfterConnectionEnd(): void {
    if (!this.#greeting) return;
    const lifecycle = this.#greeting.coordinator.getSnapshot(
      this.#sessionId,
    ).lifecycle;
    this.#setGreetingState(lifecycle === 'terminal' ? 'settled' : 'pending');
  }

  #emitGreetingTranscript(text: string): void {
    const entry: TranscriptEntry = { role: 'assistant', text, final: true };
    for (const handler of this.#transcriptHandlers) handler(entry);
    this.#emit({
      type: 'transcript',
      sessionId: this.#sessionId,
      at: Date.now(),
      role: 'assistant',
      text,
      final: true,
    });
  }

  on(event: 'state', handler: (s: VoiceSessionState) => void): Unsubscribe;
  on(event: 'transcript', handler: (t: TranscriptEntry) => void): Unsubscribe;
  on(event: 'turn_mode', handler: (event: TurnModeEvent) => void): Unsubscribe;
  /**
   * Subscribes to retained fixed-greeting lifecycle changes. The handler runs
   * after each change, not immediately on subscription; read
   * {@link RealtimeSession.greetingState} first for the current retained value.
   * Disconnects and stale connection generations cannot publish late changes
   * into a replacement generation.
   */
  on(
    event: 'greeting_state',
    handler: (state: GreetingState) => void,
  ): Unsubscribe;
  on(
    event: 'state' | 'transcript' | 'turn_mode' | 'greeting_state',
    handler:
      | ((s: VoiceSessionState) => void)
      | ((t: TranscriptEntry) => void)
      | ((event: TurnModeEvent) => void)
      | ((state: GreetingState) => void),
  ): Unsubscribe {
    if (event === 'transcript') {
      const h = handler as (t: TranscriptEntry) => void;
      this.#transcriptHandlers.add(h);
      return () => {
        this.#transcriptHandlers.delete(h);
      };
    }
    if (event === 'turn_mode') {
      const h = handler as (turnModeEvent: TurnModeEvent) => void;
      this.#turnModeHandlers.add(h);
      return () => {
        this.#turnModeHandlers.delete(h);
      };
    }
    if (event === 'greeting_state') {
      const h = handler as (state: GreetingState) => void;
      this.#greetingStateHandlers.add(h);
      return () => {
        this.#greetingStateHandlers.delete(h);
      };
    }
    const h = handler as (s: VoiceSessionState) => void;
    this.#stateHandlers.add(h);
    return () => {
      this.#stateHandlers.delete(h);
    };
  }

  #setState(next: VoiceSessionState): void {
    this.#state = next;
    for (const handler of this.#stateHandlers) handler(next);
  }

  /**
   * Retains a changed greeting state before synchronously notifying listeners;
   * an equal value is a no-op. Listeners may re-enter session methods, including
   * `disconnect()`, which invalidates the active connection generation, so the
   * caller's generation guard must run after this notification returns.
   */
  #setGreetingState(next: GreetingState): void {
    if (next === this.#greetingState) return;
    this.#greetingState = next;
    for (const handler of this.#greetingStateHandlers) handler(next);
  }

  /**
   * Retains a mode for the active generation before notifying subscribers.
   * The ordering makes a newly available manual control observable inside its
   * `turn_mode` callback. Mode updates are never mirrored to the sidechannel.
   */
  #setTurnMode(event: TurnModeEvent): void {
    const retained: TurnModeEvent =
      event.error === undefined
        ? { type: 'turn_mode', mode: event.mode }
        : event;
    this.#turnMode = retained.mode;
    this.#turnModeError = retained.error;
    this.#turnModeEstablishedEpoch = this.#connectEpoch;
    for (const handler of this.#turnModeHandlers) handler(retained);
  }

  #handleAdapterEvent(event: RealtimeAdapterEvent): void {
    switch (event.type) {
      case 'tool_call':
        // Fire-and-forget: each branch owns its own error handling and
        // always resolves, so there is nothing to await here.
        void this.#handleToolCall(event);
        break;
      case 'state':
        this.#setState(event.state);
        break;
      case 'turn_mode':
        this.#setTurnMode(event);
        break;
      case 'error':
        this.#logger.warn('adapter error', event.error);
        if (event.error instanceof RealtimeVoiceError) {
          // Invalidate any in-flight connect() (mirrors disconnect()) so a
          // late handshake success can't flip this fatally-errored session
          // back to 'connected'.
          this.#connectEpoch++;
          this.#cleanupConnection();
          this.#resetGreetingAfterConnectionEnd();
          // The adapter itself is still "connected" from its own point of
          // view (mic track live, peer connection open) — teardown() is
          // idempotent, so tearing it down here is safe even if the caller
          // also calls disconnect() later. Without this, a retry connect()
          // throws ALREADY_CONNECTED against the still-live adapter.
          void this.#adapter.disconnect().catch(() => {});
          this.#lastError = event.error;
          this.#setState('error');
        }
        break;
      case 'transcript': {
        const entry: TranscriptEntry = {
          role: event.role,
          text: event.text,
          final: event.final,
        };
        for (const handler of this.#transcriptHandlers) handler(entry);
        this.#emit({
          type: 'transcript',
          sessionId: this.#sessionId,
          at: Date.now(),
          role: event.role,
          text: event.text,
          final: event.final,
        });
        break;
      }
      case 'speech_started':
        // Activity state is derived provider-side; nothing to do here.
        break;
      default: {
        const _exhaustive: never = event;
        void _exhaustive;
      }
    }
  }

  async #handleToolCall(
    call: Extract<RealtimeAdapterEvent, { type: 'tool_call' }>,
  ): Promise<void> {
    this.#logger.debug('session: tool_call received', call);
    const startedAt = Date.now();
    this.#emit({
      type: 'tool_call',
      sessionId: this.#sessionId,
      at: startedAt,
      name: call.name,
      callId: call.callId,
      argumentsJson: call.argumentsJson,
    });

    let ok: boolean;
    if (isToolName(call.name)) {
      ok = await this.#toolHandlers[call.name](call.callId, call.argumentsJson);
    } else {
      await this.#adapter.sendToolResult(call.callId, {
        ok: false,
        summary: `Unknown tool "${call.name}".`,
      });
      ok = false;
    }

    this.#emit({
      type: 'tool_result',
      sessionId: this.#sessionId,
      at: Date.now(),
      callId: call.callId,
      ok,
      latencyMs: Date.now() - startedAt,
    });
  }

  /** Returns whether the update applied successfully (for the sidechannel result event). */
  async #handleUpdateUI(
    callId: ToolCallId,
    argumentsJson: string,
  ): Promise<boolean> {
    this.#logger.debug('update_ui: parsing arguments', argumentsJson);
    let intent: string;
    try {
      const parsed: unknown = JSON.parse(argumentsJson);
      const raw = parsed as Record<string, unknown>;
      const value =
        typeof raw.intent === 'string' && raw.intent.length > 0
          ? raw.intent
          : undefined;
      if (value === undefined) {
        throw new Error('missing "intent" string');
      }
      intent = value;
    } catch (error) {
      this.#logger.warn('update_ui: bad arguments', argumentsJson, error);
      await this.#sendUpdateUIResult(callId, {
        ok: false,
        summary: 'Could not understand that request.',
      });
      return false;
    }

    this.#logger.debug('update_ui: submitting intent', intent);
    const renderStart = Date.now();
    let outcome: SubmitIntentResult;
    try {
      // Domain-data boundary: only the plain intent string crosses here.
      outcome = (await this.#instance.submitIntent(intent)) ?? {};
      this.#logger.debug('update_ui: submitIntent resolved, awaiting idle');
      await this.#instance.waitForIdle();
      this.#logger.debug('update_ui: idle (render settled)', {
        ms: Date.now() - renderStart,
      });
    } catch (error) {
      // Fires on the routine barge-in path (queued) as well as genuine
      // pipeline failures — kept at debug level so the expected-busy case
      // doesn't spam always-on output.
      this.#logger.debug('update_ui: submitIntent/waitForIdle rejected', error);
      // Barge-in: the instance throws while a prior intent is still in
      // flight. Never let that exception reach the adapter — queue this
      // call as the latest-wins pending intent and retry once the prior
      // request settles, instead of answering busy immediately.
      // Also match the stable duck-typed code, not just `instanceof`: an
      // external consumer whose @maelstrom-co/client copy diverges from
      // this package's (a dual-package hazard) would have `instanceof`
      // silently false for a genuine in-flight rejection, turning every
      // barge-in into a hard failure instead of a queued retry.
      if (
        error instanceof RequestInFlightError ||
        (error !== null &&
          typeof error === 'object' &&
          'code' in error &&
          (error as { code?: unknown }).code === 'request_in_flight')
      ) {
        return new Promise<boolean>((resolve) => {
          this.#enqueueBargeIn({ callId, intent, resolve });
        });
      }
      // Any other rejection is a genuine render/pipeline failure, not
      // busy-ness — mislabeling it as "try again" would be a non-recovery
      // loop. Surface it distinctly, still without letting the exception
      // reach the adapter.
      this.#emit({
        type: 'timing',
        sessionId: this.#sessionId,
        at: Date.now(),
        label: 'update_ui.error',
        ms: Date.now() - renderStart,
      });
      await this.#sendUpdateUIResult(callId, {
        ok: false,
        summary: APPLY_FAILED_SUMMARY,
      });
      return false;
    }

    this.#emit({
      type: 'timing',
      sessionId: this.#sessionId,
      at: Date.now(),
      label: 'update_ui.render',
      ms: Date.now() - renderStart,
    });

    // speak-after-render: carry BOTH the structural summary (from the
    // POST-settle snapshot) and the engine's own reply, unmerged — each
    // transport decides which to voice.
    const snapshot = this.#instance.getStructuralSnapshot();
    await this.#sendUpdateUIResult(
      callId,
      this.#buildUpdateResult(outcome.userMessage, snapshot),
    );
    return true;
  }

  #sendUpdateUIResult(
    callId: ToolCallId,
    result: UpdateUIToolResult,
  ): Promise<void> {
    return this.#adapter.sendToolResult(callId, result);
  }

  // A settled update carries both fields so each transport can choose: the
  // structural `summary` (always derivable) and the engine's own `userMessage`
  // (the product voice, preferred when present). An empty/whitespace engine
  // reply is treated as absent and omitted, so `userMessage ?? summary` on the
  // consuming side falls through to the summary rather than voicing nothing.
  #buildUpdateResult(
    userMessage: string | undefined,
    snapshot: UIStructuralSnapshot,
  ): UpdateUIToolResult {
    const engineReply = userMessage?.trim();
    return {
      ok: true,
      summary: this.#summarize(snapshot),
      ...(engineReply ? { userMessage: engineReply } : {}),
    };
  }

  // Latest-wins: replaces whatever was queued, answering the call it bumps
  // right away. #queuedIntent stays assigned to an entry for its whole
  // pending lifetime (across every waitForIdle() wait, up to the point a
  // submit attempt is actually made) so a newer call can still supersede it
  // mid-wait — only once a submit is in flight does superseding stop making
  // sense, since the change may already be committed.
  #enqueueBargeIn(entry: QueuedIntent): void {
    const superseded = this.#queuedIntent;
    this.#queuedIntent = entry;
    if (superseded) {
      void this.#sendUpdateUIResult(superseded.callId, {
        ok: false,
        summary: SUPERSEDED_SUMMARY,
      }).then(() => {
        superseded.resolve(false);
      });
    }
    if (!this.#bargeInLoopRunning) {
      this.#bargeInLoopRunning = true;
      void this.#runBargeInLoop();
    }
  }

  // Singleton loop: only ever one running, driven purely off #queuedIntent so
  // a newer call enqueued while this is mid-wait is picked up without a
  // second loop starting. Each queued entry gets its own bounded attempt
  // count — resolving one way or another (superseded/applied/failed/busy)
  // always clears #queuedIntent first so a call arriving during the final
  // sendToolResult await queues cleanly for the next iteration instead of
  // being mistaken for a supersede of the entry that's finishing.
  async #runBargeInLoop(): Promise<void> {
    try {
      let attempt = 0;
      while (this.#queuedIntent) {
        const entry = this.#queuedIntent;
        attempt += 1;
        await this.#instance.waitForIdle();
        if (this.#queuedIntent !== entry) {
          attempt = 0;
          continue; // superseded while waiting — already answered, nothing to do
        }

        const renderStart = Date.now();
        let userMessage: string | undefined;
        try {
          ({ userMessage } =
            (await this.#instance.submitIntent(entry.intent)) ?? {});
        } catch (error) {
          if (this.#queuedIntent !== entry) {
            attempt = 0;
            continue; // superseded mid-submit — already answered
          }
          if (!(error instanceof RequestInFlightError)) {
            this.#queuedIntent = undefined;
            this.#emit({
              type: 'timing',
              sessionId: this.#sessionId,
              at: Date.now(),
              label: 'update_ui.error',
              ms: Date.now() - renderStart,
            });
            await this.#sendUpdateUIResult(entry.callId, {
              ok: false,
              summary: APPLY_FAILED_SUMMARY,
            });
            entry.resolve(false);
            continue;
          }
          if (attempt >= MAX_BARGE_IN_ATTEMPTS) {
            this.#queuedIntent = undefined;
            await this.#sendUpdateUIResult(entry.callId, {
              ok: false,
              summary: BUSY_SUMMARY,
            });
            entry.resolve(false);
            attempt = 0;
            continue;
          }
          await delay(BARGE_IN_RETRY_DELAY_MS);
          continue;
        }

        if (this.#queuedIntent !== entry) {
          attempt = 0;
          continue; // superseded mid-submit — already answered; the change may still apply, but this call is done
        }
        await this.#instance.waitForIdle();
        this.#queuedIntent = undefined;
        this.#emit({
          type: 'timing',
          sessionId: this.#sessionId,
          at: Date.now(),
          label: 'update_ui.render',
          ms: Date.now() - renderStart,
        });
        const snapshot = this.#instance.getStructuralSnapshot();
        await this.#sendUpdateUIResult(
          entry.callId,
          this.#buildUpdateResult(userMessage, snapshot),
        );
        entry.resolve(true);
        attempt = 0;
      }
    } finally {
      this.#bargeInLoopRunning = false;
    }
  }

  async #handleGetUIState(callId: ToolCallId): Promise<boolean> {
    this.#logger.debug('get_ui_state: reading snapshot');
    const snapshot = this.#instance.getStructuralSnapshot();
    await this.#adapter.sendToolResult(callId, snapshot);
    return true;
  }

  async #handleGetCapabilities(callId: ToolCallId): Promise<boolean> {
    this.#logger.debug('get_capabilities: reading snapshot');
    const snapshot = this.#instance.getCapabilitySnapshot();
    await this.#adapter.sendToolResult(callId, snapshot);
    return true;
  }

  // Tool-result summaries are conversational and unclamped; only grounding
  // pushes are budget-constrained, since they're injected as ambient
  // sidechannel context rather than a direct answer to a tool call.
  #clampGrounding(text: string): string {
    if (text.length <= GROUNDING_MAX_CHARS) return text;
    const message = `grounding text exceeded ${GROUNDING_MAX_CHARS} chars, truncating`;
    if (this.#groundingClampWarned) {
      this.#logger.debug(message, text.length);
    } else {
      this.#groundingClampWarned = true;
      this.#logger.warn(message, text.length);
    }
    return `${text.slice(0, GROUNDING_MAX_CHARS - 1)}…`;
  }

  #emit(event: SidechannelEvent): void {
    this.#onEvent(event);
  }
}
