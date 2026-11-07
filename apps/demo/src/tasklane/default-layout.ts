import type { TilingLayout } from '@maelstrom-co/protocol';
import {
  InstanceId,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

import { projectTasksVessel } from './vessels/project-tasks.vessel.def';
import { sourceFeedbackVessel } from './vessels/source-feedback.vessel.def';

const FEEDBACK = InstanceId('source-feedback-main');
const TASKS = InstanceId('project-tasks-main');
const FEEDBACK_LEAF = tilingLeafToken(FEEDBACK);
const TASKS_LEAF = tilingLeafToken(TASKS);

/** Grid cell size for the Tasklane Chart, in CSS pixels. */
export const TASKLANE_CELL_SIZE_PX = 80;

const SIDE_BY_SIDE_MINIMUM_WIDTH =
  (sourceFeedbackVessel.variants.snapshot.minSize.width +
    projectTasksVessel.variants.board.minSize.width) *
  TASKLANE_CELL_SIZE_PX;

/**
 * Starting screen for Tasklane: the feedback beside a wider task list. A
 * proposal like the other pages' starting screens: the first chart request
 * may resize either tile.
 */
export const TASKLANE_LAYOUT: TilingLayout = {
  type: 'tiling',
  tree: ['V:2,3', FEEDBACK_LEAF, TASKS_LEAF],
  instances: [
    {
      instanceId: FEEDBACK,
      vesselId: VesselId('source-feedback'),
      variant: VariantName('snapshot'),
    },
    {
      instanceId: TASKS,
      vesselId: VesselId('project-tasks'),
      variant: VariantName('board'),
    },
  ],
};

/** The same starting screen stacked, feedback above tasks, for a narrow chart host. */
export const TASKLANE_NARROW_LAYOUT: TilingLayout = {
  ...TASKLANE_LAYOUT,
  tree: ['H', FEEDBACK_LEAF, TASKS_LEAF],
};

/**
 * Picks the starting screen from the measured chart host width, never the
 * browser viewport. The Vessels sit side by side only when both minimum
 * widths fit. An unmeasured host gets the side-by-side screen.
 */
export function selectTasklaneLayout(
  chartHostWidth: number | null,
): TilingLayout {
  return chartHostWidth !== null && chartHostWidth < SIDE_BY_SIDE_MINIMUM_WIDTH
    ? TASKLANE_NARROW_LAYOUT
    : TASKLANE_LAYOUT;
}
