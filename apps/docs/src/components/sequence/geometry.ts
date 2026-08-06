import type { SequenceModel, SequenceStep } from './types';

/** Layout constants in stage units. The stage scales to fit its container. */
export const LANE_WIDTH = 190;
export const LANE_PADDING = 30;
export const HEADER_HEIGHT = 74;
// Wide enough that a self-loop's label, which hangs beside the loop, clears the
// label of the step below it. Concurrent steps sit one gap apart like any
// others, so this is the spacing that has to hold.
export const STEP_GAP = 76;
export const FIRST_STEP_OFFSET = 44;
/** Horizontal reach of a self-message loop. */
export const SELF_LOOP_WIDTH = 74;
/** Vertical drop of a self-message loop, kept under STEP_GAP so it cannot overlap. */
export const SELF_LOOP_HEIGHT = 30;
/**
 * Room a self-loop needs to the right of its own lifeline: the loop, the gap to
 * its label, and an allowance for the label text.
 *
 * A self-loop label is anchored `start`, so it grows rightwards away from the
 * lane grid. On the last participant that runs past the viewBox, and SVG clips
 * overflowing text silently rather than failing — the same class of quiet defect
 * the derived stage exists to prevent.
 */
export const SELF_LOOP_LABEL_REACH = SELF_LOOP_WIDTH + 30 + 150;

export interface Stage {
  readonly w: number;
  readonly h: number;
}

/**
 * Stage large enough for every lifeline and step.
 *
 * Derived rather than hand-tuned: a stage authored by hand drifts the moment a
 * step is added, and an SVG that overflows its viewBox clips silently instead
 * of failing.
 */
export function stageFor(model: SequenceModel): Stage {
  const lanes = model.participants.length;
  // The lane grid alone is too narrow when a self-loop sits on the last
  // participant, because its label hangs to the right of the final lane.
  const selfLoopReach = model.steps.reduce((widest, step) => {
    if (step.from !== step.to) return widest;
    const lane = model.participants.findIndex(({ id }) => id === step.from);
    if (lane < 0) return widest;
    return Math.max(widest, laneX(lane) + SELF_LOOP_LABEL_REACH + LANE_PADDING);
  }, 0);
  return {
    w: Math.max(LANE_PADDING * 2 + LANE_WIDTH * lanes, selfLoopReach),
    h:
      HEADER_HEIGHT +
      FIRST_STEP_OFFSET +
      STEP_GAP * Math.max(0, model.steps.length - 1) +
      SELF_LOOP_HEIGHT +
      FIRST_STEP_OFFSET,
  };
}

/** Centre of participant `index`'s lifeline. */
export function laneX(index: number): number {
  return LANE_PADDING + LANE_WIDTH * index + LANE_WIDTH / 2;
}

/** Vertical position of step `index`. */
export function stepY(index: number): number {
  return HEADER_HEIGHT + FIRST_STEP_OFFSET + STEP_GAP * index;
}

/**
 * Step numbers as displayed. Steps marked `withPrevious` share the number of
 * the step they accompany, so two simultaneous actions do not read as
 * consecutive ones.
 */
export function stepNumbers(steps: readonly SequenceStep[]): number[] {
  const numbers: number[] = [];
  let current = 0;
  for (const [index, step] of steps.entries()) {
    if (index === 0 || !step.withPrevious) current += 1;
    numbers.push(current);
  }
  return numbers;
}

export interface StepPath {
  readonly d: string;
  /** Where to hang the label. */
  readonly labelX: number;
  readonly labelY: number;
  /** Self-messages carry their label to the right of the loop, not centred. */
  readonly anchor: 'middle' | 'start';
}

function round(value: number): string {
  return value.toFixed(1);
}

/**
 * Path for one step. A message between two participants is a straight run; a
 * participant acting on itself is a loop, because a zero-length line would
 * render as nothing and silently drop the step from the drawing.
 */
export function stepPath(fromX: number, toX: number, y: number): StepPath {
  if (fromX === toX) {
    const right = fromX + SELF_LOOP_WIDTH;
    const bottom = y + SELF_LOOP_HEIGHT;
    return {
      d:
        `M${round(fromX)},${round(y)} L${round(right)},${round(y)} ` +
        `L${round(right)},${round(bottom)} L${round(fromX)},${round(bottom)}`,
      labelX: right + 26,
      labelY: y + SELF_LOOP_HEIGHT / 2,
      anchor: 'start',
    };
  }
  return {
    d: `M${round(fromX)},${round(y)} L${round(toX)},${round(y)}`,
    labelX: (fromX + toX) / 2,
    labelY: y,
    anchor: 'middle',
  };
}

/** Where the step number sits: on the line, clear of the label above it. */
export function numberPoint(path: StepPath): { x: number; y: number } {
  return path.anchor === 'start'
    ? { x: path.labelX - 14, y: path.labelY }
    : { x: path.labelX, y: path.labelY };
}

/** Where the step label sits: above a straight run, beside a loop. */
export function labelPoint(path: StepPath): { x: number; y: number } {
  return path.anchor === 'start'
    ? { x: path.labelX + 4, y: path.labelY + 5 }
    : { x: path.labelX, y: path.labelY - 20 };
}
