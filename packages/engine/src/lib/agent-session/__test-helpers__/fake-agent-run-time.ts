import type { AgentRunClock } from '../agent-run.js';

/** A manually advanced {@link AgentRunClock} with inspectable timers. */
export interface FakeAgentRunTime {
  /** The clock to hand to the run or policy. */
  readonly clock: AgentRunClock;
  /** Moves time forward and fires every timer that came due. */
  advance(ms: number): void;
  /** Moves time forward without firing timers, as when a timer callback lags. */
  advanceWithoutFiring(ms: number): void;
  /** Delays of every timer scheduled so far, in scheduling order. */
  scheduled(): number[];
  /** Number of timers neither fired nor cancelled. */
  pending(): number;
}

/** Creates a {@link FakeAgentRunTime} starting at 0 ms. */
export function createFakeAgentRunTime(): FakeAgentRunTime {
  let now = 0;
  const timers: {
    at: number;
    delay: number;
    callback: () => void;
    done: boolean;
  }[] = [];
  const fireDue = () => {
    for (const timer of timers) {
      if (!timer.done && timer.at <= now) {
        timer.done = true;
        timer.callback();
      }
    }
  };
  return {
    clock: {
      now: () => now,
      scheduleTimeout: (callback, ms) => {
        const timer = { at: now + ms, delay: ms, callback, done: false };
        timers.push(timer);
        return () => {
          timer.done = true;
        };
      },
    },
    advance: (ms) => {
      now += ms;
      fireDue();
    },
    advanceWithoutFiring: (ms) => {
      now += ms;
    },
    scheduled: () => timers.map((timer) => timer.delay),
    pending: () => timers.filter((timer) => !timer.done).length,
  };
}
