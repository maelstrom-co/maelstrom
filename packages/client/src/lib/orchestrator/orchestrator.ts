import {
  type ActionExecution,
  type ActionName,
  ChartRequestMessage,
  type ChartResizeReason,
  type InstanceId,
  type LayoutMode,
  type MaelstromResponse,
  MessageId,
  type SessionHistoryEntry,
  type SessionId,
  toError,
  type UpdateReason,
  type VariantName,
  type VesselMutationReason,
} from '@maelstrom-co/protocol';

import { ChartManager } from '../chart-manager/chart-manager.js';
import { CommandProcessor } from '../command-processor/command-processor.js';
import { ConnectionManager } from '../connection-manager/connection-manager.js';
import type {
  AssistantMessage,
  EngineConnector,
  PushConnector,
} from '../connection-manager/connector.types.js';
import type { Unsubscribe } from '../types.js';
import { UpdateCoordinator } from '../update-coordination/update-coordinator.js';
import { Logger } from '../utils/logger.js';
import { VesselManager } from '../vessel-management/vessel-manager.js';
import {
  type CapabilityOptionOmission,
  type CapabilitySnapshot,
  readCapabilitySnapshot,
} from '../voice-session/capability-snapshot.js';
import {
  readStructuralSnapshot,
  type UIStructuralSnapshot,
} from '../voice-session/ui-structural-snapshot.js';
import { buildChartRequest } from './build-chart-request.js';
import { ConnectorSupersededError } from './connector-superseded-error.js';
import type {
  OrchestratorOptions,
  OrchestratorViewState,
  ResolvedOrchestratorOptions,
} from './orchestrator.types.js';
import { resolveOrchestratorOptions } from './orchestrator.types.js';
import { RequestCoordinator } from './request-coordinator.js';
import { RequestInFlightError } from './request-in-flight-error.js';

// Disposal and a connector swap both fence, but they are not the same event to
// a caller: teardown is expected and its response is still the caller's own,
// while a swap means the response speaks for a connector this Orchestrator no
// longer uses.
type FenceReason = 'disposed' | 'superseded';

type FencedSend =
  | { readonly kind: 'ok'; readonly response: MaelstromResponse }
  | {
      readonly kind: 'stale';
      readonly reason: FenceReason;
      readonly response: MaelstromResponse;
    }
  | {
      readonly kind: 'rejected';
      readonly reason: FenceReason;
      readonly error: Error;
    };

/**
 * Composition root that creates, wires, and coordinates all microkernels.
 *
 * The Orchestrator owns **zero private state** and emits **zero events**.
 * It sequences calls across microkernels in the right order.
 * Consumers interact with microkernels directly for domain operations.
 *
 * @example
 * ```ts
 * const connector = new WebSocketConnector({ url: 'wss://api.example.com/ws' });
 * const orchestrator = new Orchestrator(connector, { debug: true });
 *
 * await orchestrator.connect();
 * const response = await orchestrator.processIntent('show me sales data');
 *
 * // Listen for events via microkernels directly:
 * orchestrator.requestCoordinator.events.on('processing_completed', (e) => { ... });
 * orchestrator.chartManager.setDimensions({ columns: 10, rows: 6 });
 * ```
 */
export class Orchestrator {
  #connector: EngineConnector;
  // Not `readonly`: a setter replaces this object rather than writing through
  // it, so every field can stay `readonly` and the compiler rejects the
  // second, unguarded write path a mutable field would leave open.
  #config: ResolvedOrchestratorOptions;
  readonly #logger: Logger;

  // Composed microkernels
  readonly #connectionManager: ConnectionManager;
  readonly #commandProcessor: CommandProcessor;
  readonly #updateCoordinator: UpdateCoordinator;
  readonly #vesselManager: VesselManager;
  readonly #chartManager: ChartManager;
  readonly #requestCoordinator: RequestCoordinator;

  #isDisposed = false;
  #unsubscribers: (() => void)[] = [];
  // Held apart from #unsubscribers: a connector swap must detach this one
  // subscription without touching the three that belong to internal
  // microkernels and outlive any connector.
  #unsubPush: (() => void) | null = null;
  #requestCounter = 0;
  #connectorEpoch = 0;
  // Vessel mutations invoked while disconnected/reconnecting are held here
  // instead of flushed into a closed connector; replayed once
  // 'connection_status_changed' reports 'connected' (mirrors ChartManager's
  // pendingResize pattern).
  #pendingMutations: VesselMutationReason[] = [];
  #optionOmissionWarned = false;

  constructor(connector: EngineConnector, options: OrchestratorOptions = {}) {
    this.#connector = connector;
    this.#config = resolveOrchestratorOptions(options);
    this.#logger = new Logger(this.#config.debug, 'Orchestrator');

    // Create microkernels
    this.#connectionManager = new ConnectionManager(connector, {
      debug: this.#config.debug,
      sessionId: this.#config.sessionId,
      ...this.#config.connection,
    });
    this.#commandProcessor = new CommandProcessor({
      debug: this.#config.debug,
      defaultActionWaitTimeoutMs: this.#config.readyTimeoutMs,
    });
    this.#updateCoordinator = new UpdateCoordinator({
      debounceDelayMs: this.#config.debounceDelayMs,
      maxWaitMs: this.#config.maxWaitMs,
      debug: this.#config.debug,
    });
    this.#vesselManager = new VesselManager({
      debug: this.#config.debug,
    });
    this.#chartManager = new ChartManager({
      debug: this.#config.debug,
    });
    this.#requestCoordinator = new RequestCoordinator(connector, {
      debug: this.#config.debug,
    });

    this.#setupSubscriptions();
  }

  // ==========================================================================
  // Microkernel accessors
  // ==========================================================================

  get connectionManager(): ConnectionManager {
    return this.#connectionManager;
  }

  get commandProcessor(): CommandProcessor {
    return this.#commandProcessor;
  }

  get vesselManager(): VesselManager {
    return this.#vesselManager;
  }

  get chartManager(): ChartManager {
    return this.#chartManager;
  }

  get requestCoordinator(): RequestCoordinator {
    return this.#requestCoordinator;
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  getConfig(): ResolvedOrchestratorOptions {
    return this.#config;
  }

  getViewState(): OrchestratorViewState {
    return {
      isProcessing: this.#requestCoordinator.isProcessing,
      isConnected:
        this.#connectionManager.store.state.connectionStatus === 'connected',
      sessionId: this.#config.sessionId,
      layoutMode: this.#config.layoutMode,
    };
  }

  /** Structural-only UI snapshot for grounding + `get_ui_state` pulls. */
  getStructuralSnapshot(): UIStructuralSnapshot {
    return readStructuralSnapshot(this);
  }

  /**
   * Change the layout mode for subsequent engine requests.
   *
   * The mode is read fresh on every request and view-state read — it is
   * never captured at construction — so this takes effect on the next
   * request with no rebuild and no loss of the arranged board. The client
   * does not lay anything out itself; the mode is forwarded to the engine,
   * which decides.
   *
   * This does not touch the stored layout. If the stored layout's own
   * `type` no longer agrees with `mode`, `buildChartRequest` resynthesizes
   * a fresh, empty layout of the requested type at request-build time
   * instead of forwarding the stale one — see the comment there for why
   * that has to happen at build time rather than here.
   */
  setLayoutMode(mode: LayoutMode): void {
    if (this.#isDisposed) {
      this.#logger.warn('setLayoutMode called after dispose; ignoring');
      return;
    }
    this.#config = { ...this.#config, layoutMode: mode };
  }

  /** Capability catalog (vessels, variants, actions) for `get_capabilities` pulls. */
  getCapabilitySnapshot(): CapabilitySnapshot {
    const { snapshot, optionOmissions } = readCapabilitySnapshot(
      this.#vesselManager.getAll(),
    );
    this.#reportOptionOmissions(optionOmissions);
    return snapshot;
  }

  /**
   * Subscribe to the render-settled signal.
   *
   * Fires whenever the CommandProcessor's command queue drains back to
   * idle — the moment a batch of layout + action commands has fully
   * applied. Both settle sources required by grounding reach this
   * transition: an engine response dispatched via `processIntent` /
   * `flushUpdates` (`set_layout` + `execute_actions` as one atomic batch),
   * and direct manipulation (a user click / variant change, which reaches
   * the processor through `commandProcessor.executeActions()` the same way
   * a React `executeAction` call does). Neither path bypasses the queue, so
   * a single subscription to the queue-idle transition grounds both.
   *
   * This is the grounding-push trigger only — it is NOT how speak-after-render
   * is sequenced. That flow awaits a specific intent's own
   * `commandProcessor.waitForIdle()` after `processIntent` resolves, so it
   * correlates to that intent's response rather than racing this global signal.
   *
   * May fire more than once per logical settle (each queue-drain-to-idle
   * transition invokes it); downstream consumers that only want the latest
   * state should debounce.
   */
  onSettled(cb: () => void): Unsubscribe {
    const isIdle = () =>
      this.#commandProcessor.store.state.status === 'idle' &&
      this.#commandProcessor.queueLength === 0;

    let wasIdle = isIdle();
    const subscription = this.#commandProcessor.store.subscribe(() => {
      const idleNow = isIdle();
      if (idleNow && !wasIdle) {
        cb();
      }
      wasIdle = idleNow;
    });

    return () => subscription.unsubscribe();
  }

  // ==========================================================================
  // Request lifecycle (sequencing only — no state)
  // ==========================================================================

  /**
   * Send a user intent to the engine and apply the response it plans.
   *
   * Any updates buffered by the UpdateCoordinator ride along in the same
   * request, so an intent typed right after a resize or a vessel mutation
   * asks the engine to plan against what the board actually looks like. The
   * response is dispatched as one atomic batch — layout first, then actions
   * — and only then are queued flush promises settled, so a consumer awaiting
   * a flush observes fully updated state.
   *
   * Single-flight: only one engine request may be outstanding, so this
   * rejects with {@link RequestInFlightError} rather than queueing.
   *
   * REJECTS WITH:
   * - `RequestInFlightError` — a request is already in flight; retry when
   *   `requestCoordinator.isProcessing` clears.
   * - `ConnectorSupersededError` — a concurrent {@link setConnector} replaced
   *   the connector while this request was in flight. The response was
   *   deliberately never applied, so the intent must be re-issued; see
   *   `setConnector` for why the fence exists.
   * - the transport's own error — either an ordinary send failure, or the
   *   failure a swap itself caused when the outgoing connector was
   *   disconnected out from under this request. Both shapes mean the intent
   *   must be re-issued.
   * - `Error('Orchestrator is disposed')` — called after {@link dispose}.
   *
   * INVARIANTS:
   * - Whenever a fenced outcome discards the response, the updates that rode
   *   along are requeued for the next flush — but the intent itself is not.
   *   Re-issuing it is the caller's call to make.
   * - A response that arrives after {@link dispose} still resolves here: the
   *   request was legitimately issued, it simply is never dispatched into a
   *   torn-down CommandProcessor.
   */
  async processIntent(intent: string): Promise<MaelstromResponse> {
    if (this.#isDisposed) {
      throw new Error('Orchestrator is disposed');
    }
    if (this.#requestCoordinator.isProcessing) {
      throw new RequestInFlightError();
    }

    const pendingUpdates = this.#updateCoordinator.takeCoalesced();
    const updates: UpdateReason[] = [
      ...pendingUpdates,
      { type: 'user_intent', intent },
    ];

    this.#logger.info(
      `Processing intent with ${updates.length} batched updates`,
    );

    const request = this.#newRequest(updates);
    // Recovery replays `pendingUpdates`, NOT `updates` — the synthetic
    // `user_intent` reason this call appended is the caller's to re-issue,
    // and replaying it would re-ask the engine for an intent nobody repeated.
    const outcome = await this.#sendFenced(request, pendingUpdates);
    // A fenced rejection keeps its original identity so consumers matching on
    // the transport error still see it.
    if (outcome.kind === 'rejected') throw outcome.error;
    if (outcome.kind === 'stale') {
      // Disposal is teardown, not failure: the request was legitimately issued
      // under a connector that still speaks for this session, so the caller
      // keeps its response — it simply is never dispatched into a torn-down
      // CommandProcessor. A swap is the opposite: the response describes a
      // board this Orchestrator never moved, and returning it would be
      // indistinguishable from an applied one.
      if (outcome.reason === 'superseded') throw new ConnectorSupersededError();
      return outcome.response;
    }
    this.#dispatchResponse(outcome.response);
    this.#requestCoordinator.resolveFlushPromises(outcome.response);
    return outcome.response;
  }

  scheduleUpdate(reason: ChartResizeReason | VesselMutationReason): void {
    this.#updateCoordinator.schedule(reason);
  }

  /**
   * Send whatever the UpdateCoordinator has buffered now, instead of waiting
   * for its debounce to fire, and apply the response the same way
   * {@link processIntent} does.
   *
   * Use it when something must reach the engine at a known moment — a test, a
   * teardown, a UI gesture that should not sit out the debounce window. If a
   * request is already in flight this coalesces with it rather than sending a
   * second one: the buffered updates are put back and the returned promise
   * settles with that request's outcome.
   *
   * RESOLVES `null` — deliberately the same value for every "nothing landed"
   * case, because none of them is a failure the caller can act on:
   * - the Orchestrator is disposed;
   * - nothing was buffered;
   * - a concurrent {@link setConnector} superseded the response, which was
   *   therefore never applied (the updates are requeued for the next flush);
   * - the send itself failed *because* of that swap — the transport error is
   *   swallowed rather than thrown, and logged at warn with the epoch that
   *   fenced it, which is the only thing distinguishing it from a request
   *   that was never sent.
   *
   * REJECTS with the transport's error when a send fails under the current
   * connector — an ordinary failure, not a fenced one, is never swallowed.
   */
  async flushUpdates(): Promise<MaelstromResponse | null> {
    if (this.#isDisposed) return null;

    const updates = this.#updateCoordinator.takeCoalesced();
    if (updates.length === 0) {
      return null;
    }

    if (this.#requestCoordinator.isProcessing) {
      this.#logger.info('Already processing, queueing flush promise');
      for (const update of updates) this.#updateCoordinator.schedule(update);
      return this.#requestCoordinator.queueFlush();
    }

    const request = this.#newRequest(updates);
    const outcome = await this.#sendFenced(request, updates);
    // Both fenced shapes collapse into the `null` that already means "nothing
    // to report" — a swap is not a failure the caller can act on, and the
    // updates were requeued. The rejected shape swallows a real transport
    // error to get there, which is why the fence logs it with epoch context:
    // that log is the only thing separating "the fence ate it" from a request
    // that was never sent.
    if (outcome.kind !== 'ok') return null;
    this.#dispatchResponse(outcome.response);
    this.#requestCoordinator.resolveFlushPromises(outcome.response);
    return outcome.response;
  }

  // ==========================================================================
  // Local action invocation
  // ==========================================================================

  /**
   * Invoke a vessel action locally — the client-authoritative path for actions
   * a user triggers directly in the UI (e.g. a button click), as opposed to
   * actions the engine returns in an execution plan.
   *
   * WHAT it does, in order:
   * 1. Validates that `instanceId` exists and that `action` is declared on the
   *    instance's **current** variant. If either check fails it logs a warning
   *    and no-ops — it never throws, so it is safe to call straight from a
   *    render callback.
   * 2. If the action declares a `transitionsTo` variant that exists on the
   *    vessel, it updates the store's variant **synchronously, before the
   *    runner runs** — the store is authoritative and the UI reflects the new
   *    variant immediately (no optimistic-override-then-rollback dance).
   * 3. Runs the action's registered runner through the same CommandProcessor /
   *    ActionManager machinery as engine-plan actions (runner-readiness wait,
   *    execution timeout, `action_error` emission).
   * 4. If the runner fails (error result, throw, or timeout), reverts the
   *    variant — but only if the store variant is still the one this call set,
   *    so a newer transition or an engine layout that landed in between wins.
   * 5. When (and only when) a transition actually happened in step 2, schedules
   *    a `vessel_mutation` update so the engine can re-plan layout. Bursts are
   *    coalesced by the UpdateCoordinator's debounce.
   *
   * WHY: vessels declare their own state machines, so a locally-invoked action
   * with a `transitionsTo` is a fact the client already knows — applying it
   * locally makes the client the authority instead of waiting on an engine
   * round-trip.
   *
   * INVARIANTS:
   * - Never throws; invalid input warns and no-ops.
   * - The variant transition is applied before the runner is awaited.
   * - A revert never clobbers a variant a later write already changed.
   * - No `transitionsTo`, or no effective variant change → no engine update.
   *
   * @param instanceId - The instance to act on; must exist in the store.
   * @param action - The action name; must be declared on the current variant.
   * @param params - Optional parameter object passed to the runner verbatim.
   *
   * @example
   * ```ts
   * // In a vessel's render callback:
   * <button onClick={() => orchestrator.invokeAction(instanceId, 'expand')}>
   *   Expand
   * </button>
   * ```
   */
  invokeAction(
    instanceId: InstanceId,
    action: ActionName,
    params?: Record<string, unknown>,
  ): void {
    if (this.#isDisposed) {
      this.#logger.warn('invokeAction called after dispose; ignoring');
      return;
    }

    const instance =
      this.#commandProcessor.store.state.instances.get(instanceId);
    if (!instance) {
      this.#logger.warn(`invokeAction: unknown instance "${instanceId}"`);
      return;
    }

    const vessel = this.#vesselManager.get(instance.vesselId);
    if (!vessel) {
      this.#logger.warn(
        `invokeAction: no vessel definition for "${instance.vesselId}"`,
      );
      return;
    }

    const currentVariant = instance.variant;
    const actionDef = vessel.variants[currentVariant]?.actions.find(
      (a) => a.name === action,
    );
    if (!actionDef) {
      this.#logger.warn(
        `invokeAction: action "${action}" is not available on variant "${currentVariant}" of instance "${instanceId}"`,
      );
      return;
    }

    // Transition first: apply the declared variant change locally so the UI
    // updates before the (async) runner runs.
    let transition: { from: VariantName; to: VariantName } | null = null;
    const target = actionDef.transitionsTo;
    if (target !== undefined && target !== currentVariant) {
      if (!Object.hasOwn(vessel.variants, target)) {
        this.#logger.warn(
          `invokeAction: action "${action}" transitionsTo unknown variant "${target}"; running without transition`,
        );
      } else if (
        this.#commandProcessor.setVariantIfCurrent(
          instanceId,
          currentVariant,
          target,
        )
      ) {
        transition = { from: currentVariant, to: target };
        let paramsSuffix = '';
        if (params && Object.keys(params).length > 0) {
          try {
            // params are app-provided and unvalidated; cap the serialized
            // projection so a large value can't bloat the engine prompt.
            // (A validated/redacted projection is a separate concern.)
            const serialized = JSON.stringify(params);
            const MAX_PARAMS_CHARS = 200;
            paramsSuffix = ` with ${
              serialized.length > MAX_PARAMS_CHARS
                ? `${serialized.slice(0, MAX_PARAMS_CHARS)}…`
                : serialized
            }`;
          } catch {
            // params may be circular or contain a BigInt — fall back to no
            // suffix rather than let JSON.stringify throw and abort the
            // (already-applied) transition.
            paramsSuffix = '';
          }
        }
        this.#scheduleMutation({
          type: 'vessel_mutation',
          instanceId,
          changes: `user invoked "${action}"${paramsSuffix}: variant ${currentVariant} → ${target}`,
        });
      }
    }

    const execution: ActionExecution = { instanceId, action, params };
    void this.#runLocalAction(execution, transition);
  }

  // ==========================================================================
  // Connection lifecycle
  // ==========================================================================

  async connect(): Promise<void> {
    await this.#connectionManager.connect();
  }

  async disconnect(): Promise<void> {
    // Preserve unflushed vessel_mutations across the disconnect so a click that
    // hasn't reached the wire replays on reconnect instead of vanishing.
    // takeCoalesced() drains + clears the coordinator (buffer + timers) like
    // clear() did, but returns the pending updates so mutations can be retained.
    for (const update of this.#updateCoordinator.takeCoalesced()) {
      if (update.type === 'vessel_mutation')
        this.#pendingMutations.push(update);
    }
    await this.#connectionManager.disconnect();
  }

  // ==========================================================================
  // Cross-cutting (needs config + connector)
  // ==========================================================================

  async addAssistantMessage(message: string): Promise<void> {
    this.#logger.info('Injecting assistant message');
    const assistantMessage: AssistantMessage = {
      id: MessageId(),
      message,
    };
    await this.#connector.addAssistantMessage(assistantMessage);
  }

  /**
   * Fetch the engine-recorded history for the given session.
   *
   * Use this to rehydrate a conversation after a refresh, on a new device,
   * or in a parallel tab — anywhere a developer has persisted a session id
   * and wants to seed UI state from the server. The session id is passed
   * explicitly (rather than read from the orchestrator's own
   * `config.sessionId`) so callers can fetch any session they have an id
   * for, including a session that predates this orchestrator instance.
   *
   * Errors from the connector (transport failure, engine error) propagate
   * as thrown `Error`s — same shape as `addAssistantMessage` and
   * `processIntent`.
   */
  async getHistory(
    sessionId: SessionId,
  ): Promise<readonly SessionHistoryEntry[]> {
    if (this.#isDisposed) {
      throw new Error('Orchestrator is disposed');
    }
    return this.#connector.getHistory(sessionId);
  }

  /**
   * Replace the connector on a live Orchestrator, preserving the session.
   *
   * Use this when the transport changes but the session does not — re-auth is
   * the motivating case. The arranged board, vessel registry, and chart
   * dimensions all survive; only the transport is swapped.
   *
   * Any request already in flight is *fenced*, not cancelled: `EngineConnector`
   * exposes no abort, so the old request runs to completion and its response
   * is discarded rather than applied. The guarantee is scoped to dispatch: a
   * response computed under superseded credentials is never handed to the
   * CommandProcessor, so it cannot reach the UI — but it has already been
   * committed to `requestCoordinator.lastResponse` and emitted as
   * `processing_completed` by the time the fence runs, so anything subscribed
   * to those two surfaces still observes it.
   *
   * A caller's pending {@link processIntent} always *rejects* under a swap,
   * in one of two shapes: {@link ConnectorSupersededError} when the response
   * arrived after the swap, or the transport's own error when the swap made
   * the send itself fail (the outgoing connector was disconnected out from
   * under it). Either way the intent took no effect and must be re-issued.
   * A pending {@link flushUpdates} resolves `null` for both shapes instead —
   * its updates are requeued, so there is nothing for the caller to redo.
   */
  setConnector(next: EngineConnector): void {
    if (this.#isDisposed) {
      // dispose() early-returns on a second call, so a push subscription
      // attached past this point would never be torn down — the incoming
      // connector would keep the whole disposed graph reachable.
      this.#logger.warn('setConnector called after dispose; ignoring');
      return;
    }
    if (Object.is(next, this.#connector)) return;

    this.#unsubPush?.();
    this.#unsubPush = null;

    this.#connector = next;
    this.#connectorEpoch += 1;
    this.#connectionManager.setConnector(next);
    this.#requestCoordinator.setConnector(next);

    this.#attachPushSubscription();
  }

  // ==========================================================================
  // Disposal
  // ==========================================================================

  async dispose(): Promise<void> {
    if (this.#isDisposed) return;

    this.#isDisposed = true;
    for (const unsub of this.#unsubscribers) {
      unsub();
    }
    this.#unsubscribers = [];
    this.#unsubPush?.();
    this.#unsubPush = null;

    await this.#connectionManager.dispose();
    this.#chartManager.dispose();
    this.#vesselManager.dispose();
    this.#updateCoordinator.dispose();
    this.#commandProcessor.dispose();
    this.#requestCoordinator.dispose();
    this.#pendingMutations = [];
  }

  // ==========================================================================
  // Private methods
  // ==========================================================================

  #setupSubscriptions(): void {
    // Wire chart dimension changes → schedule resize updates
    const unsubDimensions = this.#chartManager.events.on(
      'dimensions_changed',
      (event) => {
        if (
          this.#connectionManager.store.state.connectionStatus === 'connected'
        ) {
          this.scheduleUpdate(event.resize);
        }
      },
    );
    this.#unsubscribers.push(unsubDimensions);

    // Wire connection status → flush pending resize on connect
    const unsubConnection = this.#connectionManager.events.on(
      'connection_status_changed',
      (event) => {
        if (event.status === 'connected') {
          const pendingResize = this.#chartManager.getPendingResize();
          if (pendingResize) {
            this.scheduleUpdate(pendingResize);
            this.#chartManager.clearPendingResize();
          }

          if (this.#pendingMutations.length > 0) {
            const drained = this.#pendingMutations;
            this.#pendingMutations = [];
            for (const m of drained) this.scheduleUpdate(m);
          }
        }
      },
    );
    this.#unsubscribers.push(unsubConnection);

    // Wire UpdateCoordinator timer-triggered flushes
    const unsubFlush = this.#updateCoordinator.events.on(
      'updates_flushed',
      async (event) => {
        if (this.#isDisposed) return;

        if (this.#requestCoordinator.isProcessing) {
          // A request is already in flight; its completion will
          // handle any queued flush promises. UpdateCoordinator.flush()
          // already cleared its buffer before emitting this event, so
          // requeue the updates here or they're lost for good — mirrors
          // flushUpdates().
          for (const update of event.updates) {
            this.#updateCoordinator.schedule(update);
          }
          return;
        }

        let request: ChartRequestMessage;
        try {
          request = this.#newRequest(event.updates);
        } catch (err) {
          // Synchronous construction failure (e.g., ChartRequestMessage's
          // resolveTimestamp guard). RequestCoordinator never saw it, so we
          // need to log here AND settle queued flush promises.
          const error = toError(err);
          this.#logger.error(
            `Timer-flush request construction failed: ${error.message}`,
          );
          this.#requestCoordinator.rejectFlushPromises(error);
          return;
        }

        let outcome: FencedSend;
        try {
          outcome = await this.#sendFenced(request, event.updates);
        } catch (err) {
          // Only genuine failures reach here now — a swap-induced rejection
          // is a fenced outcome, not something to reject queued flushes with.
          // send() already surfaces the error via the 'error' event. Settle
          // queued flush promises so consumers don't time out.
          const error = toError(err);
          this.#requestCoordinator.rejectFlushPromises(error);
          return;
        }
        if (outcome.kind !== 'ok') return;

        try {
          this.#dispatchResponse(outcome.response);
        } catch (err) {
          // dispatchResponse delegates to CommandProcessor; failures here are
          // not surfaced upstream, so we log and reject queued flushes.
          const error = toError(err);
          this.#logger.error(`Timer-flush dispatch failed: ${error.message}`);
          this.#requestCoordinator.rejectFlushPromises(error);
          return;
        }
        this.#requestCoordinator.resolveFlushPromises(outcome.response);
      },
    );
    this.#unsubscribers.push(unsubFlush);

    this.#attachPushSubscription();
  }

  #attachPushSubscription(): void {
    if (!('onPushMessage' in this.#connector)) return;
    const isFenced = this.#captureFence('Push message');
    this.#unsubPush = (this.#connector as PushConnector).onPushMessage(
      (response: MaelstromResponse) => {
        // Logged before the fence, not after: the discarded case drops an
        // entire engine-authored layout, so it must be at least as visible as
        // the applied one.
        this.#logger.info('Received push message');
        if (isFenced()) return;
        this.#dispatchResponse(response);
      },
    );
  }

  // A response can outlive the state it was meant to update: the transport has
  // no cancellation, so dispose() cannot stop an in-flight request, and
  // setConnector cannot cancel a request already sent to the old connector.
  // Applying either anyway throws from the torn-down CommandProcessor as an
  // unhandled rejection, or worse, lands a layout computed under a connector
  // that no longer speaks for this session.
  //
  // The epoch is captured here, when the work is issued, and read back through
  // the live field only inside the returned check: a caller that captured it
  // itself could pass a value read after an await, leaving a fence that
  // compares the field to itself and silently never trips.
  //
  // The check logs when it trips because discarding is legitimate here — the
  // log is the only evidence it happened, and without it "my intent did
  // nothing after re-auth" is indistinguishable from a request never sent.
  // A swap drops work someone asked for (warn); teardown is expected (debug).
  #captureFence(subject: string): (detail?: string) => FenceReason | null {
    const epoch = this.#connectorEpoch;
    return (detail?: string) => {
      let reason: FenceReason | null = null;
      if (this.#isDisposed) reason = 'disposed';
      else if (epoch !== this.#connectorEpoch) reason = 'superseded';
      if (reason === null) return null;

      const message = `${subject} discarded (${reason}); epoch ${epoch} → ${this.#connectorEpoch}${detail ? `; ${detail}` : ''}`;
      if (reason === 'disposed') this.#logger.debug(message);
      else this.#logger.warn(message);
      return reason;
    };
  }

  // Fencing a request costs more than dropping its response, because the
  // request already carried these updates out of the coordinator — nothing
  // else replays them, so without requeuing they are gone for good instead of
  // riding the next flush. And every flush that queued behind the fenced
  // request via queueFlush() has to be settled here or it hangs until an
  // unrelated later request happens to resolve it with an irrelevant
  // response. `null`, not the response: it was never applied, and `null` is
  // already what flushUpdates() returns when there is nothing to report.
  #recoverFencedRequest(ownedUpdates: readonly UpdateReason[]): void {
    // Debug, not warn: the fence itself already warned, and this is the
    // recovery it triggered rather than a second thing going wrong.
    this.#logger.debug(
      `Recovering fenced request: requeued ${ownedUpdates.length} update reason(s), settled queued flushes with null`,
    );
    for (const update of ownedUpdates) this.#updateCoordinator.schedule(update);
    this.#requestCoordinator.resolveFlushPromises(null);
  }

  // A swap supersedes an in-flight request two ways, not one: the old
  // connector may still resolve (nothing cancels it), or it may reject
  // because ConnectionManager disconnected it out from under the request.
  // Both are the same event, so both fence — reading the epoch once, on
  // whichever exit the send takes, is what stops those shapes drifting apart.
  //
  // The try wraps only the send: a throw raised by the fence path itself must
  // not be caught by its own handler. A failure under the CURRENT epoch is an
  // ordinary transport error and rethrows untouched.
  async #sendFenced(
    request: ChartRequestMessage,
    ownedUpdates: readonly UpdateReason[],
  ): Promise<FencedSend> {
    const isFenced = this.#captureFence(`Request ${request.id}`);
    let response: MaelstromResponse;
    try {
      response = await this.#requestCoordinator.send(request);
    } catch (err) {
      const error = toError(err);
      const reason = isFenced(`send rejected: ${error.message}`);
      if (!reason) throw err;
      this.#recoverFencedRequest(ownedUpdates);
      return { kind: 'rejected', reason, error };
    }
    const reason = isFenced('response arrived after the fence closed');
    if (reason) {
      this.#recoverFencedRequest(ownedUpdates);
      return { kind: 'stale', reason, response };
    }
    return { kind: 'ok', response };
  }

  async #runLocalAction(
    execution: ActionExecution,
    transition: { from: VariantName; to: VariantName } | null,
  ): Promise<void> {
    const outcome = await this.#commandProcessor.runLocalAction(execution);
    // Only a failed runner reverts. 'succeeded' keeps the transition; 'skipped'
    // (no runner ready within the readiness window) also keeps it — a pure
    // transition has nothing to run or undo.
    if (outcome === 'failed' && transition) {
      // Guarded revert: only undo when our transition still stands.
      const reverted = this.#commandProcessor.setVariantIfCurrent(
        execution.instanceId,
        transition.to,
        transition.from,
      );
      if (reverted) {
        // The original transition mutation may have already flushed to the
        // engine before this (slow) runner failed — tell it about the
        // rollback too, or it keeps believing the stale target variant.
        this.#scheduleMutation({
          type: 'vessel_mutation',
          instanceId: execution.instanceId,
          changes: `action "${execution.action}" failed; reverted variant ${transition.to} → ${transition.from}`,
        });
      }
    }
  }

  // Routes a vessel_mutation through the live engine notification path when
  // connected, or holds it when disconnected/reconnecting so a click against
  // a closed connector isn't silently lost (mirrors ChartManager's
  // pendingResize pattern for chart_resize).
  #scheduleMutation(reason: VesselMutationReason): void {
    if (this.#connectionManager.store.state.connectionStatus === 'connected') {
      this.scheduleUpdate(reason);
    } else {
      this.#pendingMutations.push(reason);
    }
  }

  // The snapshot only tells the model that values are missing; the vessel
  // author gets no signal at all unless it surfaces here. Warn once — a
  // snapshot is read on every `get_capabilities` pull, so warning each time
  // would flood the console — and keep repeats at debug level so the detail
  // is still recoverable with debug logging on.
  #reportOptionOmissions(omissions: readonly CapabilityOptionOmission[]): void {
    if (omissions.length === 0) return;
    const message = `capability snapshot omitted declared option values for ${omissions.length} parameter(s)`;
    if (this.#optionOmissionWarned) {
      this.#logger.debug(message, omissions);
    } else {
      this.#optionOmissionWarned = true;
      this.#logger.warn(message, omissions);
    }
  }

  #dispatchResponse(response: MaelstromResponse): void {
    this.#commandProcessor.dispatch(
      { kind: 'set_layout', layout: response.layout },
      { kind: 'execute_actions', executionPlan: response.executionPlan },
    );
  }

  #newRequest(updates: UpdateReason[]): ChartRequestMessage {
    const messageId = this.#nextRequestId();
    const request = buildChartRequest({
      updates,
      instances: this.#commandProcessor.store.state.instances,
      chartDimensions: this.#chartManager.store.state.chartDimensions,
      layout: this.#commandProcessor.store.state.layout,
      vessels: this.#vesselManager.getAll(),
      config: { layoutMode: this.#config.layoutMode },
    });
    return ChartRequestMessage({
      sessionId: this.#config.sessionId,
      id: messageId,
      request,
    });
  }

  // The id format (`req-<epoch_ms>-<counter>`) is the contract that history
  // and the request correlator both index on. Centralizing here means a
  // single edit to change the recipe.
  #nextRequestId(): MessageId {
    return MessageId(`req-${Date.now()}-${++this.#requestCounter}`);
  }
}
