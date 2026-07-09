import { Logger, RequestInFlightError } from '@maelstrom-co/client';
import type {
  UiStructuralSnapshot,
  Unsubscribe,
  VoiceSession,
  VoiceSessionState,
} from '@maelstrom-co/client';
import type { SessionId, SidechannelEvent } from '@maelstrom-co/protocol';

import { groundedDebounce } from './grounding-debounce.js';
import type {
  RealtimeAdapterEvent,
  RealtimeProviderAdapter,
  RealtimeToolSpec,
} from './provider-adapter.types.js';

/**
 * The minimal bridge `RealtimeSession` needs from a Maelstrom instance.
 * `Orchestrator` maps onto this via a small wrapper (`submitIntent` ->
 * `processIntent`, `waitForIdle` -> `commandProcessor.waitForIdle`) — this
 * interface exists so the realtime package depends on a narrow seam rather
 * than the whole `Orchestrator` surface.
 */
export interface RealtimeInstance {
  submitIntent(intent: string): Promise<void>;
  waitForIdle(): Promise<void>;
  getStructuralSnapshot(): UiStructuralSnapshot;
  onSettled(cb: () => void): Unsubscribe;
}

/**
 * Pure, model-free formatter turning a structural snapshot into a short
 * sentence for grounding text or a `get_ui_state` / `update_ui` tool result.
 * Injectable so callers can swap in richer copy without touching sequencing
 * logic; the default is deterministic and O(1) — grounding must never
 * involve a model call.
 */
export type SummarizeFn = (snapshot: UiStructuralSnapshot) => string;

/** Options for constructing a {@link RealtimeSession}. */
export interface RealtimeSessionOptions {
  readonly adapter: RealtimeProviderAdapter;
  readonly instance: RealtimeInstance;
  /**
   * Maelstrom session this realtime session belongs to. Stamped onto every
   * emitted {@link SidechannelEvent}. Must match the session the `instance`
   * runs under (e.g. the Orchestrator's own session).
   */
  readonly sessionId: SessionId;
  /** Debounce window for latest-wins grounding pushes. Defaults to 1000ms. */
  readonly groundingDebounceMs?: number;
  readonly summarize?: SummarizeFn;
  readonly onEvent?: (event: SidechannelEvent) => void;
  /** Enable verbose debug tracing (default false). */
  readonly debug?: boolean;
}

const UPDATE_UI_TOOL: RealtimeToolSpec = {
  name: 'update_ui',
  description:
    'Apply a natural-language UI intent (e.g. "show labs") and update the on-screen layout accordingly. The result is withheld until the change has rendered.',
  parametersJsonSchema: {
    type: 'object',
    properties: { intent: { type: 'string' } },
    required: ['intent'],
    additionalProperties: false,
  },
};

const GET_UI_STATE_TOOL: RealtimeToolSpec = {
  name: 'get_ui_state',
  description:
    'Read the current structural UI state (what is on screen and its layout) without changing anything.',
  parametersJsonSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

const DEFAULT_INSTRUCTIONS =
  "You are the voice interface for a Maelstrom-powered UI. Call update_ui with a short natural-language instruction to change what's on screen, and get_ui_state to check what's currently shown. Only narrate a UI change after update_ui's result confirms it rendered.";

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
  readonly callId: string;
  readonly intent: string;
  readonly resolve: (ok: boolean) => void;
}

function defaultSummarize(snapshot: UiStructuralSnapshot): string {
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
 * immediately from a structural snapshot; render-settle events push a
 * debounced, latest-wins grounding string; and every tool round-trip is
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
 *     submitIntent: (intent) => orchestrator.processIntent(intent).then(() => {}),
 *     waitForIdle: () => orchestrator.commandProcessor.waitForIdle(),
 *     getStructuralSnapshot: () => orchestrator.getStructuralSnapshot(),
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
  readonly #pushGrounding: ((snapshot: UiStructuralSnapshot) => void) & { cancel(): void };
  readonly #logger: Logger;

  #state: VoiceSessionState = 'idle';
  readonly #stateHandlers = new Set<(s: VoiceSessionState) => void>();
  #unsubscribeAdapter: Unsubscribe | undefined;
  #unsubscribeSettled: Unsubscribe | undefined;
  #queuedIntent: QueuedIntent | undefined;
  #bargeInLoopRunning = false;
  #groundingClampWarned = false;

  constructor(options: RealtimeSessionOptions) {
    this.#adapter = options.adapter;
    this.#instance = options.instance;
    this.#sessionId = options.sessionId;
    this.#summarize = options.summarize ?? defaultSummarize;
    this.#onEvent = options.onEvent ?? (() => {});
    this.#logger = new Logger(options.debug ?? false, 'realtime');
    this.#pushGrounding = groundedDebounce((snapshot: UiStructuralSnapshot) => {
      this.#adapter.injectGrounding(this.#clampGrounding(this.#summarize(snapshot)));
    }, options.groundingDebounceMs ?? DEFAULT_GROUNDING_DEBOUNCE_MS);
  }

  get state(): VoiceSessionState {
    return this.#state;
  }

  async connect(): Promise<void> {
    // Re-entry guard: without it, a second connect() before the first
    // resolves would stack a second set of subscriptions on top of the
    // first's (only the last unsubscribe would ever be reachable).
    if (this.#state === 'connected' || this.#state === 'connecting') return;

    this.#setState('connecting');
    this.#unsubscribeAdapter = this.#adapter.on((event) => {
      this.#handleAdapterEvent(event);
    });
    try {
      await this.#adapter.connect({
        tools: [UPDATE_UI_TOOL, GET_UI_STATE_TOOL],
        instructions: DEFAULT_INSTRUCTIONS,
      });
    } catch (error) {
      this.#cleanupConnection();
      this.#setState('error');
      throw error;
    }
    // Grounding only makes sense once the data channel is actually up — a UI
    // settle mid-handshake would otherwise schedule a debounced push that
    // fires against a still-closed channel.
    this.#unsubscribeSettled = this.#instance.onSettled(() => {
      this.#pushGrounding(this.#instance.getStructuralSnapshot());
    });
    this.#setState('connected');
  }

  async disconnect(): Promise<void> {
    this.#cleanupConnection();
    await this.#adapter.disconnect();
    this.#setState('idle');
  }

  #cleanupConnection(): void {
    this.#unsubscribeAdapter?.();
    this.#unsubscribeSettled?.();
    this.#unsubscribeAdapter = undefined;
    this.#unsubscribeSettled = undefined;
    this.#pushGrounding.cancel();
    // Dropped silently, not answered: the adapter this call would have
    // replied on is going away too. The retry loop (if any is mid-wait)
    // notices the identity mismatch on its next wake and stops on its own —
    // the abandoned promise is left unresolved, never rejected.
    this.#queuedIntent = undefined;
  }

  on(_event: 'state', handler: (s: VoiceSessionState) => void): Unsubscribe {
    this.#stateHandlers.add(handler);
    return () => {
      this.#stateHandlers.delete(handler);
    };
  }

  #setState(next: VoiceSessionState): void {
    this.#state = next;
    for (const handler of this.#stateHandlers) handler(next);
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
      case 'error':
        this.#logger.warn('adapter error', event.error);
        break;
      case 'transcript':
      case 'speech_started':
        // Not part of the tool/grounding surface this session drives.
        break;
    }
  }

  async #handleToolCall(call: {
    callId: string;
    name: string;
    argumentsJson: string;
  }): Promise<void> {
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
    switch (call.name) {
      case 'update_ui':
        ok = await this.#handleUpdateUi(call.callId, call.argumentsJson);
        break;
      case 'get_ui_state':
        ok = await this.#handleGetUiState(call.callId);
        break;
      default:
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
  async #handleUpdateUi(callId: string, argumentsJson: string): Promise<boolean> {
    this.#logger.debug('update_ui: parsing arguments', argumentsJson);
    let intent: string;
    try {
      const parsed: unknown = JSON.parse(argumentsJson);
      intent = (parsed as { intent?: unknown }).intent as string;
      if (typeof intent !== 'string' || intent.length === 0) {
        throw new Error('missing "intent" string');
      }
    } catch (error) {
      this.#logger.warn('update_ui: bad arguments', argumentsJson, error);
      await this.#adapter.sendToolResult(callId, {
        ok: false,
        summary: 'Could not understand that request.',
      });
      return false;
    }

    this.#logger.debug('update_ui: submitting intent', intent);
    const renderStart = Date.now();
    try {
      // Domain-data boundary: only the plain intent string crosses here.
      await this.#instance.submitIntent(intent);
      this.#logger.debug('update_ui: submitIntent resolved, awaiting idle');
      await this.#instance.waitForIdle();
      this.#logger.debug('update_ui: idle (render settled)', { ms: Date.now() - renderStart });
    } catch (error) {
      // Fires on the routine barge-in path (queued) as well as genuine
      // pipeline failures — kept at debug level so the expected-busy case
      // doesn't spam always-on output.
      this.#logger.debug('update_ui: submitIntent/waitForIdle rejected', error);
      // Barge-in: the instance throws while a prior intent is still in
      // flight. Never let that exception reach the adapter — queue this
      // call as the latest-wins pending intent and retry once the prior
      // request settles, instead of answering busy immediately.
      if (error instanceof RequestInFlightError) {
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
      await this.#adapter.sendToolResult(callId, {
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

    // speak-after-render: summary is derived from the POST-settle snapshot.
    const snapshot = this.#instance.getStructuralSnapshot();
    await this.#adapter.sendToolResult(callId, {
      summary: this.#summarize(snapshot),
    });
    return true;
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
      void this.#adapter
        .sendToolResult(superseded.callId, { ok: false, summary: SUPERSEDED_SUMMARY })
        .then(() => {
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
        try {
          await this.#instance.submitIntent(entry.intent);
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
            await this.#adapter.sendToolResult(entry.callId, {
              ok: false,
              summary: APPLY_FAILED_SUMMARY,
            });
            entry.resolve(false);
            continue;
          }
          if (attempt >= MAX_BARGE_IN_ATTEMPTS) {
            this.#queuedIntent = undefined;
            await this.#adapter.sendToolResult(entry.callId, {
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
        await this.#adapter.sendToolResult(entry.callId, {
          summary: this.#summarize(snapshot),
        });
        entry.resolve(true);
        attempt = 0;
      }
    } finally {
      this.#bargeInLoopRunning = false;
    }
  }

  async #handleGetUiState(callId: string): Promise<boolean> {
    this.#logger.debug('get_ui_state: reading snapshot');
    const snapshot = this.#instance.getStructuralSnapshot();
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
