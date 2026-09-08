import type {
  ChartRequest,
  InstanceId,
  VesselAction,
  VesselId,
  VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

import { isResizeOnlyBatch } from '../../update-reasons.js';

/**
 * What triggered the turn an execution plan is being parsed for.
 *
 * A union rather than a flag pair: `preExisting` is only meaningful on a
 * resize-only turn, so the set is built on those turns alone and cannot be
 * read on any other.
 */
export type ExecutionTurn =
  | {
      /** The turn carries user intent or a Vessel mutation. */
      readonly kind: 'intentful';
    }
  | {
      /** Nothing but a chart resize triggered the turn. */
      readonly kind: 'resize_only';
      /**
       * Instances the request already carried. Read off the request, never
       * off the healed layout: an instance the LLM introduces in the same
       * response has no prior state, so the action that configures it is a
       * first write rather than a replay.
       */
      readonly preExisting: ReadonlySet<InstanceId>;
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
  return {
    kind: 'resize_only',
    preExisting: new Set(
      request.instances.map((instance) => instance.instanceId),
    ),
  };
}

/**
 * Refuses an action the turn cannot safely run, or returns `undefined`.
 *
 * The Engine never sees Vessel contents, so on a turn triggered by nothing
 * but a resize it cannot tell a first run of an action apart from a re-run of
 * one an earlier turn already performed. Only actions their author declared
 * `idempotent` survive that ambiguity, since re-running them changes nothing;
 * everything else is refused against an instance that predates the response.
 */
export function turnRefusesAction(
  turn: ExecutionTurn,
  instance: VesselInstanceSnapshot,
  actionDef: VesselAction,
): TurnRefusal | undefined {
  if (turn.kind !== 'resize_only') return undefined;
  if (actionDef.idempotent) return undefined;
  if (!turn.preExisting.has(instance.instanceId)) return undefined;
  return { kind: 'non_idempotent_on_resize', vesselId: instance.vesselId };
}
