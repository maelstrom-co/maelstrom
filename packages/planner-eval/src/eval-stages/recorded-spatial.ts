import { readFile } from 'node:fs/promises';

import {
  GATE_THRESHOLD,
  type GateAnswer,
} from '@maelstrom-co/planner-jev/_eval';

/**
 * The `spatial` gate one live planner arm answered, per scenario turn, so
 * the layout stage eval can feed the stage the signal the live planner
 * produced instead of the scenario's tag.
 */
export interface RecordedSpatialSignal {
  /** How many scenario turns recorded a spatial gate. */
  readonly size: number;
  /** The gate recorded for `scenarioId` at `repeat`; undefined when the turn recorded none. */
  lookup(scenarioId: string, repeat: number): GateAnswer | undefined;
}

/**
 * The spatial gate `arm` answered in every live record that has one. The
 * answer is read from the probability against the gated select stage's
 * threshold. Records of other arms, and turns whose select stage produced
 * no gates, are left out.
 */
export function recordedSpatialSignal(
  records: readonly unknown[],
  arm: string,
): RecordedSpatialSignal {
  const gates = new Map<string, GateAnswer>();
  for (const record of records) {
    const turn = liveTurn(record);
    if (turn === undefined || turn.arm !== arm) continue;
    gates.set(key(turn.scenarioId, turn.repeat), {
      answer: turn.probability >= GATE_THRESHOLD ? 'yes' : 'no',
      probability: turn.probability,
      confidence: turn.confidence,
    });
  }
  return {
    size: gates.size,
    lookup: (scenarioId, repeat) => gates.get(key(scenarioId, repeat)),
  };
}

/** {@link recordedSpatialSignal} over the `records.json` a full planner eval wrote at `path`. */
export async function loadRecordedSpatialSignal(
  path: string,
  arm: string,
): Promise<RecordedSpatialSignal> {
  const records: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(records))
    throw new Error(`${path} holds no list of eval records`);
  return recordedSpatialSignal(records, arm);
}

function key(scenarioId: string, repeat: number): string {
  return `${scenarioId}#${repeat}`;
}

function liveTurn(record: unknown):
  | {
      readonly arm: string;
      readonly scenarioId: string;
      readonly repeat: number;
      readonly probability: number;
      readonly confidence: number;
    }
  | undefined {
  if (!isObject(record)) return undefined;
  const { arm, scenarioId, repeat, stageOutputs } = record;
  if (
    typeof arm !== 'string' ||
    typeof scenarioId !== 'string' ||
    typeof repeat !== 'number' ||
    !isObject(stageOutputs)
  )
    return undefined;
  const select = stageOutputs.jevSelect;
  const gates = isObject(select) ? select.gates : undefined;
  const spatial = isObject(gates) ? gates.spatial : undefined;
  if (!isObject(spatial) || typeof spatial.probability !== 'number')
    return undefined;
  return {
    arm,
    scenarioId,
    repeat,
    probability: spatial.probability,
    confidence: typeof spatial.confidence === 'number' ? spatial.confidence : 0,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
