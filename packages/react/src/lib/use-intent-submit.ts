import type {
  AgentRunState,
  IntentResult,
  MessageId,
  Orchestrator,
  SettledAgentRun,
  SubmittedIntent,
  VoiceSessionState,
} from '@maelstrom-co/client';
import { useStore } from '@tanstack/react-store';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { MaelstromContextPair } from './context.js';
import { useStoreSelector } from './use-store-selector.js';

/**
 * Settled outcome of a submission made through `useIntentSubmit()`.
 *
 * Unknown outcomes (`status: 'unknown'` on `'single-request'`, `status: 'lost'`
 * on `'agent'`) stay unknown and are never replayed automatically.
 */
export type IntentSubmitOutcome =
  | {
      /** Route that handled the submission. */
      readonly route: 'single-request';
      /** Terminal single-request status. */
      readonly status: IntentResult['status'];
      /** Settled single-request result. */
      readonly result: IntentResult;
    }
  | {
      /** Route that handled the submission. */
      readonly route: 'agent';
      /** Settled Agent Run status. */
      readonly status: SettledAgentRun['status'];
      /** Settled Agent Run state. */
      readonly result: SettledAgentRun;
    };

/**
 * Non-success settled outcome passed to {@link IntentSubmitFailureClassifier}
 * and {@link UseIntentSubmitOptions.onFailure}.
 */
export type IntentSubmitFailure =
  | {
      /** Route that handled the submission. */
      readonly route: 'single-request';
      /** Refusal, failure, or unknown single-request status. */
      readonly status: 'not_submitted' | 'failed' | 'unknown';
      /** Settled single-request failure or refusal. */
      readonly result: Exclude<IntentResult, { readonly status: 'applied' }>;
    }
  | {
      /** Route that handled the submission. */
      readonly route: 'agent';
      /** Refusal, failure, or lost Agent Run status. */
      readonly status: 'not_submitted' | 'failed' | 'lost';
      /** Settled Agent Run failure, refusal, or loss. */
      readonly result: Extract<
        SettledAgentRun,
        { readonly status: 'not_submitted' | 'failed' | 'lost' }
      >;
    };

/**
 * Decides whether a settled refusal or failure should restore the cleared
 * draft. Returning `true` restores the draft only when it is still the latest
 * submission and the user has not edited the draft since submitting. Never
 * replays or retries a submission.
 */
export type IntentSubmitFailureClassifier = (
  failure: IntentSubmitFailure,
) => boolean;

/**
 * Default classifier for {@link UseIntentSubmitOptions.shouldRestoreDraft}.
 *
 * Restores the draft for refusals that never reached the engine (`not_submitted`
 * on either route, or `lost` with `lostReason: 'send_failed'` on the agent
 * route). Leaves unknown outcomes (`'unknown'` on `'single-request'`, `'lost'`
 * with other reasons on `'agent'`) and other failures unrestored.
 */
export function defaultShouldRestoreDraft(
  failure: IntentSubmitFailure,
): boolean {
  if (failure.route === 'single-request') {
    return failure.status === 'not_submitted';
  }
  return (
    failure.result.status === 'not_submitted' ||
    (failure.result.status === 'lost' &&
      failure.result.lostReason === 'send_failed')
  );
}

/** Options for `m.useIntentSubmit()`. */
export interface UseIntentSubmitOptions {
  /** Controlled draft value. Omit to let the hook manage draft state internally. */
  readonly draft?: string;
  /** Controlled draft setter, paired with `draft`. */
  readonly onDraftChange?: (value: string) => void;
  /** Initial draft value when uncontrolled. Defaults to `''`. */
  readonly initialDraft?: string;
  /**
   * Optional guard called with the trimmed non-empty text before submitting.
   * Return `false` to block submission and keep the current draft.
   */
  readonly beforeSubmit?: (text: string) => boolean;
  /**
   * Pluggable classifier deciding whether a settled refusal or failure
   * restores the cleared draft. Defaults to {@link defaultShouldRestoreDraft}.
   */
  readonly shouldRestoreDraft?: IntentSubmitFailureClassifier;
  /**
   * Called synchronously right after `orchestrator.submit(...)` returns, with
   * the submission handle and the raw text submitted.
   */
  readonly onSubmitted?: (submitted: SubmittedIntent, text: string) => void;
  /**
   * Called when a submission settles with a refusal, failure, or unknown
   * outcome while this hook remains mounted on the same Orchestrator.
   */
  readonly onFailure?: (failure: IntentSubmitFailure) => void;
  /**
   * Current voice session state from `useVoice().state`. Contributes to
   * {@link UseIntentSubmitResult.busy} when `'thinking'`.
   */
  readonly voiceState?: VoiceSessionState;
  /**
   * Explicit voice-busy flag. Contributes to
   * {@link UseIntentSubmitResult.busy} when `true`.
   */
  readonly voiceBusy?: boolean;
}

/** Return value of `m.useIntentSubmit()`. */
export interface UseIntentSubmitResult {
  /** Current draft text. */
  readonly draft: string;
  /** Updates the draft and marks a user edit so older failures cannot overwrite it. */
  readonly setDraft: (value: string) => void;
  /**
   * Submits `text` when provided, or the current `draft` otherwise, through
   * the Orchestrator's configured route. Returns `null` when the trimmed text
   * is empty or `beforeSubmit` returns `false`. Never replays or retries an
   * unknown outcome.
   */
  readonly submit: (text?: string) => SubmittedIntent | null;
  /**
   * True while the Orchestrator is planning, applying commands, running an
   * open Agent Run, or while voice is thinking (via `voiceState` or
   * `voiceBusy`).
   */
  readonly busy: boolean;
  /**
   * Outcome of the most recent submission that settled during this
   * Orchestrator's lifetime, or `null` before any submission has settled.
   */
  readonly lastOutcome: IntentSubmitOutcome | null;
}

/** Creates the `m.useIntentSubmit()` hook bound to one factory context. */
export function createUseIntentSubmit(contextPair: MaelstromContextPair) {
  const { useMaelstromContext } = contextPair;

  return function useIntentSubmit(
    options: UseIntentSubmitOptions = {},
  ): UseIntentSubmitResult {
    const { orchestrator } = useMaelstromContext();
    const isControlled = options.draft !== undefined;
    const [internalDraft, setInternalDraft] = useState(
      () => options.initialDraft ?? '',
    );
    const draft = isControlled ? options.draft : internalDraft;
    const [lastOutcome, setLastOutcome] = useState<IntentSubmitOutcome | null>(
      null,
    );
    const [staleWatched, setStaleWatched] = useState<
      readonly StaleSubmission[]
    >([]);

    const draftRevision = useRef(0);
    const latestSubmission = useRef<TrackedSubmission | null>(null);
    const lifetime = useRef({ active: true });
    const current = useRef({
      draft,
      isControlled,
      onDraftChange: options.onDraftChange,
      beforeSubmit: options.beforeSubmit,
      shouldRestoreDraft: options.shouldRestoreDraft,
      onSubmitted: options.onSubmitted,
      onFailure: options.onFailure,
    });
    useLayoutEffect(() => {
      if (isControlled && draft !== current.current.draft) {
        draftRevision.current++;
      }
      current.current = {
        draft,
        isControlled,
        onDraftChange: options.onDraftChange,
        beforeSubmit: options.beforeSubmit,
        shouldRestoreDraft: options.shouldRestoreDraft,
        onSubmitted: options.onSubmitted,
        onFailure: options.onFailure,
      };
    });

    useEffect(() => {
      const owner = lifetime.current.active
        ? lifetime.current
        : { active: true };
      lifetime.current = owner;
      latestSubmission.current = null;
      setLastOutcome(null);
      setStaleWatched([]);
      return () => {
        owner.active = false;
      };
    }, [orchestrator]);

    const writeDraft = useCallback((value: string) => {
      current.current = { ...current.current, draft: value };
      if (!current.current.isControlled) setInternalDraft(value);
      current.current.onDraftChange?.(value);
    }, []);

    const setDraft = useCallback(
      (value: string) => {
        draftRevision.current++;
        writeDraft(value);
      },
      [writeDraft],
    );

    const restoreDraft = useCallback(
      (tracked: TrackedSubmission) => {
        if (
          latestSubmission.current === tracked &&
          draftRevision.current === tracked.revision &&
          !current.current.draft
        ) {
          writeDraft(tracked.rawText);
        }
      },
      [writeDraft],
    );

    const handleFailure = useCallback(
      (tracked: TrackedSubmission, failure: IntentSubmitFailure) => {
        const classify =
          current.current.shouldRestoreDraft ?? defaultShouldRestoreDraft;
        if (tracked.accepted && classify(failure)) {
          restoreDraft(tracked);
        }
        current.current.onFailure?.(failure);
      },
      [restoreDraft],
    );

    const runs = useStore(orchestrator.agent.store, (state) => state.runs);
    useEffect(() => {
      if (staleWatched.length === 0) return;
      const remaining = staleWatched.filter(({ tracked, inputId }) => {
        const run = runs.find((known) => known.inputId === inputId);
        if (run === undefined) return false;
        if (run.status === 'failed') {
          const failure: IntentSubmitFailure = {
            route: 'agent',
            status: 'failed',
            result: run,
          };
          setLastOutcome(failure);
          handleFailure(tracked, failure);
          return false;
        }
        return isStaleLost(run) || isAgentRunOpen(run);
      });
      if (remaining.length !== staleWatched.length) setStaleWatched(remaining);
    }, [runs, staleWatched, handleFailure]);

    const submit = useCallback(
      (text?: string): SubmittedIntent | null => {
        const usingDraft = text === undefined;
        const rawText = usingDraft ? current.current.draft : text;
        const trimmed = rawText.trim();
        if (!trimmed) return null;
        if (
          current.current.beforeSubmit &&
          !current.current.beforeSubmit(trimmed)
        ) {
          return null;
        }
        const submitted = orchestrator.submit(trimmed, { source: 'text' });
        const owner = lifetime.current;
        if (submitted.accepted && usingDraft) {
          setDraft('');
        }
        const tracked: TrackedSubmission = {
          rawText,
          revision: draftRevision.current,
          accepted: submitted.accepted,
        };
        latestSubmission.current = tracked;
        current.current.onSubmitted?.(submitted, rawText);

        if (submitted.route === 'single-request') {
          void submitted.result.then((result) => {
            if (!owner.active) return;
            const outcome: IntentSubmitOutcome = {
              route: 'single-request',
              status: result.status,
              result,
            };
            setLastOutcome(outcome);
            if (result.status !== 'applied') {
              handleFailure(tracked, {
                route: 'single-request',
                status: result.status,
                result,
              });
            }
          });
        } else {
          void submitted.result.then((result) => {
            if (!owner.active) return;
            const outcome: IntentSubmitOutcome = {
              route: 'agent',
              status: result.status,
              result,
            };
            setLastOutcome(outcome);
            if (
              result.status === 'not_submitted' ||
              result.status === 'failed' ||
              result.status === 'lost'
            ) {
              handleFailure(tracked, {
                route: 'agent',
                status: result.status,
                result,
              });
              if (
                result.status === 'lost' &&
                result.lostReason === 'stale_run'
              ) {
                setStaleWatched((known) => [
                  ...known,
                  { tracked, inputId: result.inputId },
                ]);
              }
            }
          });
        }

        return submitted;
      },
      [orchestrator, setDraft, handleFailure],
    );

    const stores = useMemo(
      () => [
        orchestrator.requestCoordinator.store,
        orchestrator.intentScheduler.store,
        orchestrator.commandProcessor.store,
        orchestrator.agent.store,
      ],
      [orchestrator],
    );

    const clientBusy = useStoreSelector(stores, () =>
      isOrchestratorBusy(orchestrator),
    );
    const busy =
      clientBusy ||
      options.voiceBusy === true ||
      options.voiceState === 'thinking';

    return {
      draft,
      setDraft,
      submit,
      busy,
      lastOutcome,
    };
  };
}

interface TrackedSubmission {
  readonly rawText: string;
  readonly revision: number;
  readonly accepted: boolean;
}

interface StaleSubmission {
  readonly tracked: TrackedSubmission;
  readonly inputId: MessageId;
}

function isAgentRunOpen(run: AgentRunState): boolean {
  return (
    run.status === 'pending' ||
    run.status === 'working' ||
    run.status === 'streaming'
  );
}

function isStaleLost(run: AgentRunState): boolean {
  return run.status === 'lost' && run.lostReason === 'stale_run';
}

function isOrchestratorBusy(orchestrator: Orchestrator): boolean {
  if (orchestrator.requestCoordinator.store.state.isProcessing) return true;
  if (orchestrator.intentScheduler.store.state.phase !== 'idle') return true;
  if (
    orchestrator.commandProcessor.store.state.status === 'processing' ||
    orchestrator.commandProcessor.queueLength > 0
  ) {
    return true;
  }
  return orchestrator.agent.store.state.runs.some(isAgentRunOpen);
}
