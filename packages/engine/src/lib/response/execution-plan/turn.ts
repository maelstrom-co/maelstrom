import type {
  ChartRequest,
  VesselAction,
  VesselId,
  VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

import { isResizeOnlyBatch } from '../../update-reasons.js';
import type { RawActionExecution } from './types.js';

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
export type TurnRefusal =
  | {
      /** The Action's author never declared re-running it harmless. */
      readonly kind: 'non_idempotent_on_resize';
      readonly vesselId: VesselId;
    }
  | {
      /** The Action is declared idempotent but was emitted with parameters. */
      readonly kind: 'parameterized_on_resize';
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
 *
 * Declared idempotence is not enough on its own. It promises that running an
 * action twice with the same parameters matches running it once, and says
 * nothing about running it with different ones. A resize carries no user
 * intent, which leaves the conversation history as the only place a parameter
 * value can have come from, so a parameterized action on such a turn is a
 * replay by construction. `expand()` and `showWeek()` are reshapes the new
 * size may call for and pass; `setLocation("Tokyo")` could only have got
 * "Tokyo" from an earlier turn and is refused, whether it repeats that turn
 * or overwrites it with a change nobody asked for. Parameters are read as the
 * model emitted them, not as the definition declares them: an action free to
 * take parameters but invoked without any carries no history-derived value.
 *
 * The stronger check, comparing an emitted action against the earlier
 * emissions for the same instance and action, stays unbuilt on purpose. It
 * needs a per-session record of what was emitted, kept for no other purpose,
 * to refuse a subset of what the parameter rule already refuses. Build it
 * when a Vessel author has a parameterized action that genuinely has to fire
 * on a resize; until then, a refused `setLocation` here is the rule working
 * rather than a bug to loosen.
 */
export function turnRefusesAction(
  turn: ExecutionTurn,
  item: RawActionExecution,
  instance: VesselInstanceSnapshot,
  actionDef: VesselAction,
): TurnRefusal | undefined {
  if (turn.kind !== 'resize_only') return undefined;
  if (!actionDef.idempotent) {
    return { kind: 'non_idempotent_on_resize', vesselId: instance.vesselId };
  }
  if (emitsParams(item.paramsJson)) {
    return { kind: 'parameterized_on_resize', vesselId: instance.vesselId };
  }
  return undefined;
}

// A model spells "no parameters" either by omitting the field or by sending
// an empty object, and neither carries a value an earlier turn could have
// supplied. Everything else counts as parameterized, unreadable JSON
// included: a payload the Engine cannot decode is not one it can clear.
const EMPTY_PARAMS_JSON = /^\s*\{\s*\}\s*$/;

function emitsParams(paramsJson: string | undefined): boolean {
  if (paramsJson === undefined) return false;
  return !EMPTY_PARAMS_JSON.test(paramsJson);
}
