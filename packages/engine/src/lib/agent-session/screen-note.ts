import {
  type ActionExecution,
  type AgentActionOutcome,
  type ChartRequest,
  getVisibleInstanceIds,
} from '@maelstrom-co/protocol';

/** Most characters a screen update note may take, ellipsis included. */
export const SCREEN_NOTE_MAX_CHARS = 300;

/** What {@link describeScreenUpdate} reads from one acknowledged UI change. */
export interface ScreenUpdate {
  /** The Execution Plan the browser applied, in order. */
  readonly executionPlan: readonly ActionExecution[];
  /**
   * The outcomes the browser reported, positional: entry i describes Action i
   * of `executionPlan`. A missing entry counts as not ok.
   */
  readonly actionOutcomes: readonly AgentActionOutcome[];
  /** The Chart the browser acknowledged after applying the change. */
  readonly chart: ChartRequest;
}

/**
 * Describes a show that is waiting its turn, so the model knows a screen
 * change is on its way and which tool results it will reflect.
 *
 * One name reads `Show queued: latest_order result.` Two names read
 * `Show queued: latest_order and search_products results.` Three or more
 * name a comma list whose last two names join with `and`.
 *
 * @param toolNames - Names of the tools whose results the show reflects, in
 * call order. Must not be empty.
 */
export function describeShowQueued(toolNames: readonly string[]): string {
  const noun = toolNames.length === 1 ? 'result' : 'results';
  return `Show queued: ${joinWithAnd(toolNames)} ${noun}.`;
}

/**
 * Describes what the screen shows after the browser acknowledged a UI change,
 * as one line for the run transcript.
 *
 * Each Action reads `ran <action> on <vesselId> → <variant>`, or
 * `failed <action> on <vesselId>` when its positional outcome is not ok. The
 * Vessel id and Variant come from the acknowledged Chart's `instances`. An
 * Action on an Instance the Chart does not list names the Instance id and
 * omits the Variant. An empty plan reads `Screen updated: layout changed.`
 * The visible Instances follow as `Visible: <vesselId> (<variant>), ...` or
 * `Visible: nothing.` The note is capped at {@link SCREEN_NOTE_MAX_CHARS}
 * characters and ends with an ellipsis when cut. It never includes Action
 * parameters, Instance props, failure messages or Planner text.
 */
export function describeScreenUpdate({
  executionPlan,
  actionOutcomes,
  chart,
}: ScreenUpdate): string {
  const instancesById = new Map(
    chart.instances.map((instance) => [instance.instanceId, instance]),
  );

  const actions = executionPlan.map((execution, index) => {
    const instance = instancesById.get(execution.instanceId);
    const target = instance?.vesselId ?? execution.instanceId;
    if (actionOutcomes[index]?.ok !== true) {
      return `failed ${execution.action} on ${target}`;
    }
    const reached = instance === undefined ? '' : ` → ${instance.variant}`;
    return `ran ${execution.action} on ${target}${reached}`;
  });
  const updated =
    actions.length === 0
      ? 'Screen updated: layout changed.'
      : `Screen updated: ${actions.join(', ')}.`;

  const visible = [...getVisibleInstanceIds(chart.layout)].map((instanceId) => {
    const instance = instancesById.get(instanceId);
    return instance === undefined
      ? instanceId
      : `${instance.vesselId} (${instance.variant})`;
  });
  const visibleLine =
    visible.length === 0
      ? 'Visible: nothing.'
      : `Visible: ${visible.join(', ')}.`;

  return capNote(`${updated} ${visibleLine}`);
}

function joinWithAnd(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function capNote(note: string): string {
  if (note.length <= SCREEN_NOTE_MAX_CHARS) return note;
  return `${note.slice(0, SCREEN_NOTE_MAX_CHARS - 1)}…`;
}
