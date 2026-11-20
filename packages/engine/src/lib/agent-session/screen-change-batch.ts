import type { JsonValue } from '@maelstrom-co/protocol';

import type { AgentRunClock } from './agent-run.js';
import {
  describeScreenChangeResult,
  type ScreenChangeResult,
} from './screen-change-result.js';

/** How long a turn's batch waits for admitted `change_screen` calls to register, counted from the first registration. */
export const SCREEN_CHANGE_BATCH_FILL_TIMEOUT_MS = 1_000;

/** One goal of a submitted batch. */
export interface ScreenChangeBatchGoal {
  /**
   * The call id: the provider tool call id inside the batch, the run's
   * `CallId` once submitted to the Screen Change queue. Neither reaches the
   * Planner request or `ui_change`.
   */
  readonly callId: string;
  /** The `user_intent` reason id the goal plans under, `r1`, `r2`, ... in admission order. */
  readonly reasonId: string;
  /** What the screen should show, in plain words. */
  readonly goal: string;
  /** Exact values the goal refers to. Absent means none. */
  readonly referents?: Readonly<Record<string, JsonValue>>;
}

/** Everything a {@link ScreenChangeBatch} needs. */
export interface ScreenChangeBatchOptions {
  /** Sends the goals as one Planner request and returns one answer per goal, in order. */
  readonly submit: (
    goals: readonly ScreenChangeBatchGoal[],
  ) => readonly Promise<ScreenChangeResult>[];
  /** Resolves once the turn's Server Tools have finished. */
  readonly whenServerToolsIdle: () => Promise<void>;
  /** Schedules a callback and returns a function that cancels it. */
  readonly scheduleTimeout: AgentRunClock['scheduleTimeout'];
  /** Defaults to {@link SCREEN_CHANGE_BATCH_FILL_TIMEOUT_MS}. */
  readonly fillTimeoutMs?: number;
  /** Called when the fill timeout flushed before every admitted call registered. */
  readonly onFillTimeout: (counts: {
    readonly admitted: number;
    readonly registered: number;
  }) => void;
}

/**
 * The `change_screen` calls of one model turn, sent as one Planner request.
 * A call is admitted when its guard runs and registered when it executes.
 * The batch submits once every admitted call registered and the turn's
 * Server Tools finished. The fill timeout flushes what registered when an
 * admitted call never registers. A registration after a flush starts a new
 * submission.
 */
export interface ScreenChangeBatch {
  /** Admits a call and assigns its reason id. Admitting a call twice keeps its first id. */
  admit(callId: string): void;
  /** Registers an admitted call's goal and resolves with its result. */
  register(
    callId: string,
    goal: string,
    referents: Readonly<Record<string, JsonValue>> | undefined,
  ): Promise<ScreenChangeResult>;
  /** Whether the call's goal was submitted. */
  isSent(callId: string): boolean;
  /**
   * Answers every unsent registration `cancelled` and stops the batch, so
   * nothing is submitted afterwards. A submitted goal keeps its answer.
   */
  cancelUnsent(): void;
}

/** Creates the {@link ScreenChangeBatch} of one model turn. */
export function createScreenChangeBatch({
  submit,
  whenServerToolsIdle,
  scheduleTimeout,
  fillTimeoutMs = SCREEN_CHANGE_BATCH_FILL_TIMEOUT_MS,
  onFillTimeout,
}: ScreenChangeBatchOptions): ScreenChangeBatch {
  const reasonIds = new Map<string, string>();
  const awaitingRegistration = new Set<string>();
  const unsent: Registration[] = [];
  const sent = new Set<string>();
  let cancelFill: (() => void) | undefined;
  let flushing = false;
  let stopped = false;

  return {
    admit(callId) {
      if (stopped || reasonIds.has(callId)) return;
      reasonIds.set(callId, `r${reasonIds.size + 1}`);
      awaitingRegistration.add(callId);
    },
    register(callId, goal, referents) {
      if (stopped) return Promise.resolve(cancelledResult(goal));
      if (!reasonIds.has(callId))
        reasonIds.set(callId, `r${reasonIds.size + 1}`);
      awaitingRegistration.delete(callId);
      return new Promise((resolve) => {
        unsent.push({
          goal: {
            callId,
            reasonId: reasonIds.get(callId) ?? callId,
            goal,
            ...(referents === undefined ? {} : { referents }),
          },
          resolve,
        });
        cancelFill ??= scheduleTimeout(fillTimedOut, fillTimeoutMs);
        if (awaitingRegistration.size === 0) void flush();
      });
    },
    isSent: (callId) => sent.has(callId),
    cancelUnsent() {
      stopped = true;
      stopFill();
      for (const registration of unsent.splice(0))
        registration.resolve(cancelledResult(registration.goal.goal));
    },
  };

  function admissionOrder(registration: Registration): number {
    return [...reasonIds.keys()].indexOf(registration.goal.callId);
  }

  function stopFill() {
    cancelFill?.();
    cancelFill = undefined;
  }

  function fillTimedOut() {
    cancelFill = undefined;
    if (stopped) return;
    onFillTimeout({
      admitted: unsent.length + awaitingRegistration.size,
      registered: unsent.length,
    });
    awaitingRegistration.clear();
    void flush();
  }

  async function flush() {
    stopFill();
    if (flushing) return;
    flushing = true;
    try {
      await whenServerToolsIdle();
    } finally {
      flushing = false;
    }
    if (stopped) return;
    const registrations = unsent
      .splice(0)
      .sort((left, right) => admissionOrder(left) - admissionOrder(right));
    if (registrations.length === 0) return;
    for (const { goal } of registrations) sent.add(goal.callId);
    const answers = submit(registrations.map(({ goal }) => goal));
    registrations.forEach((registration, index) => {
      const answer = answers[index];
      if (answer === undefined) {
        registration.resolve(cancelledResult(registration.goal.goal));
        return;
      }
      void answer.then(registration.resolve);
    });
  }
}

interface Registration {
  readonly goal: ScreenChangeBatchGoal;
  readonly resolve: (result: ScreenChangeResult) => void;
}

function cancelledResult(goal: string): ScreenChangeResult {
  return {
    status: 'cancelled',
    summary: describeScreenChangeResult(goal, 'cancelled'),
  };
}
