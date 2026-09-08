import type {
  ChartRequest,
  VesselAction,
  VesselId,
  VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

import { isResizeOnlyBatch } from '../../update-reasons.js';

/**
 * What triggered the turn an execution plan is being parsed for.
 *
 * A union rather than a boolean so a later trigger class can carry the data
 * only it needs without widening every other turn.
 */
export type ExecutionTurn =
  | {
      /** The turn carries user intent or a Vessel mutation. */
      readonly kind: 'intentful';
    }
  | {
      /** Nothing but a chart resize triggered the turn. */
      readonly kind: 'resize_only';
    };

/** An action the turn itself refuses, independent of whether it resolves. */
export type TurnRefusal = {
  readonly kind: 'non_idempotent_on_resize';
  readonly vesselId: VesselId;
};

/** Classifies a request into the {@link ExecutionTurn} its update reasons describe. */
export function classifyExecutionTurn(request: ChartRequest): ExecutionTurn {
  if (!isResizeOnlyBatch(request.context.updateReasons)) {
    return { kind: 'intentful' };
  }
  return { kind: 'resize_only' };
}

/**
 * Refuses an action the turn cannot safely run, or returns `undefined`.
 *
 * The Engine never sees Vessel contents, so on a turn triggered by nothing
 * but a resize it cannot tell a first run of an action apart from a re-run of
 * one an earlier turn already performed. Only actions their author declared
 * `idempotent` survive that ambiguity, since re-running them changes nothing.
 * A freshly declared instance id is no evidence of fresh state: a Vessel is
 * free to back every instance with one store, so an action replayed at a new
 * id can still write the state an older id already holds.
 */
export function turnRefusesAction(
  turn: ExecutionTurn,
  instance: VesselInstanceSnapshot,
  actionDef: VesselAction,
): TurnRefusal | undefined {
  if (turn.kind !== 'resize_only') return undefined;
  if (actionDef.idempotent) return undefined;
  return { kind: 'non_idempotent_on_resize', vesselId: instance.vesselId };
}
