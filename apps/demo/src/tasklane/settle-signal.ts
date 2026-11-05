import type {
  MaelstromExtension,
  MaelstromExtensionContext,
} from '@maelstrom-co/react';
import { useEffect, useRef } from 'react';

export interface TasklaneSettleSignal {
  /** Runs `onSettled` each time the orchestrator's command queue drains back to idle. */
  useOnSettled: (onSettled: () => void) => void;
}

/**
 * A definition republished while a command batch is in flight is refused, and
 * the Planner must see options that match the stores before the next queued
 * intent is sent. The orchestrator's settle signal is the earliest moment both
 * hold, so republishing runs there instead of on a timer.
 */
export const tasklaneSettleSignal: MaelstromExtension<TasklaneSettleSignal> = (
  ctx: MaelstromExtensionContext,
) => ({
  useOnSettled: (onSettled) => {
    const { orchestrator } = ctx.useMaelstromContext();
    const latest = useRef(onSettled);
    latest.current = onSettled;
    useEffect(
      () => orchestrator.onSettled(() => latest.current()),
      [orchestrator],
    );
  },
});
