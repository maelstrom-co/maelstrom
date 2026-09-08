/**
 * Scores one resize-replay trial against the action the trial seeded.
 *
 * A resize-only turn is allowed to return actions: an idempotent variant
 * transition is exactly what a narrower chart may call for, and the resize
 * instruction invites it. "The model returned something" is therefore not the
 * defect. The defect is narrower: the model re-emitted the specific content
 * mutation an earlier turn already ran. Only that identity scores a hit.
 *
 * Both sides of the Engine's heal step have to be searched. A replay the
 * guard let through lands in the surviving execution plan with its params
 * intact; a replay the guard refused never reaches the caller and shows up
 * only as a refusal in the operator log, which carries the instance and
 * action but no params.
 */

/** An action that survived the heal step into the response's execution plan. */
export interface PlannedAction {
  readonly instanceId: string;
  readonly action: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

/** An action the heal step refused, as the operator log identifies it. */
export interface RefusedAction {
  readonly reason: string;
  readonly instanceId?: string;
  readonly action?: string;
  readonly vesselId?: string;
}

/** Everything one trial's response said about the actions the model chose. */
export interface TrialObservation {
  readonly plan: readonly PlannedAction[];
  readonly refused: readonly RefusedAction[];
}

/** Where a replay of the seeded action turned up, if it turned up at all. */
export interface ReplayVerdict {
  /** The headline: the model replayed the seeded action, either side of the guard. */
  readonly replayed: boolean;
  /** The seeded action survived the guard and reached the caller. */
  readonly survived: boolean;
  /** The seeded action was refused, so the model emitted it and lost. */
  readonly refused: boolean;
  /** Actions the model emitted that are not the seeded replay. */
  readonly otherActions: readonly string[];
}

/**
 * The action the trial's seeded prior turn already ran. A replay of exactly
 * this is the defect the eval measures.
 */
export const SEEDED_ACTION = {
  instanceId: 'tasks-main',
  action: 'addTask',
  params: { title: 'Buy milk' } as Readonly<Record<string, unknown>>,
} as const;

/**
 * Whether the trial's response replayed the seeded action, on either side of
 * the guard.
 */
export function isSeededReplay(observation: TrialObservation): boolean {
  return scoreTrial(observation).replayed;
}

/**
 * Locates the seeded replay and collects everything else the model emitted.
 *
 * The `otherActions` bucket keeps a sanctioned transition, or a mutation
 * aimed at some other action, readable in the trial log without counting
 * toward the headline rate.
 */
export function scoreTrial(observation: TrialObservation): ReplayVerdict {
  const survived = observation.plan.some(isSeededPlanEntry);
  const refused = observation.refused.some(isSeededRefusal);
  const otherActions = [
    ...observation.plan
      .filter((entry) => !isSeededPlanEntry(entry))
      .map(renderPlannedAction),
    ...observation.refused
      .filter((entry) => !isSeededRefusal(entry))
      .map(renderRefusedAction),
  ];
  return { replayed: survived || refused, survived, refused, otherActions };
}

/** Renders a planned action for the trial log. */
export function renderPlannedAction(entry: PlannedAction): string {
  return `${entry.instanceId}.${entry.action}(${JSON.stringify(entry.params ?? {})})`;
}

/** Renders a refused action for the trial log. */
export function renderRefusedAction(entry: RefusedAction): string {
  return `${entry.instanceId ?? '?'}.${entry.action ?? '?'} refused:${entry.reason}`;
}

function isSeededPlanEntry(entry: PlannedAction): boolean {
  return (
    entry.instanceId === SEEDED_ACTION.instanceId &&
    entry.action === SEEDED_ACTION.action &&
    carriesSeededParams(entry.params)
  );
}

// The refusal record carries no params, so identity is all there is to match
// on. That is enough: a mutation the model aimed at the seeded instance and
// action is the replay whatever arguments it invented.
function isSeededRefusal(entry: RefusedAction): boolean {
  return (
    entry.instanceId === SEEDED_ACTION.instanceId &&
    entry.action === SEEDED_ACTION.action
  );
}

// Extra keys are tolerated: they change nothing about which prior effect the
// action repeats.
function carriesSeededParams(
  params: Readonly<Record<string, unknown>> | undefined,
): boolean {
  return Object.entries(SEEDED_ACTION.params).every(
    ([key, value]) => params?.[key] === value,
  );
}
