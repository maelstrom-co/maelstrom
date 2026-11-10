import { describe, expect, it } from 'vitest';

import {
  selectTasklaneLayout,
  TASKLANE_CELL_SIZE_PX,
  TASKLANE_LAYOUT,
  TASKLANE_NARROW_LAYOUT,
} from './default-layout';
import { projectTasksVessel } from './vessels/project-tasks.vessel.def';
import { sourceFeedbackVessel } from './vessels/source-feedback.vessel.def';

const sideBySideMinimumWidth =
  (sourceFeedbackVessel.variants.snapshot.minSize.width +
    projectTasksVessel.variants.board.minSize.width) *
  TASKLANE_CELL_SIZE_PX;

describe('selectTasklaneLayout', () => {
  it('stacks the Vessels when the host is narrower than both minimum widths side by side', () => {
    expect(selectTasklaneLayout(sideBySideMinimumWidth - 1)).toBe(
      TASKLANE_NARROW_LAYOUT,
    );
  });

  it('places the Vessels side by side once both minimum widths fit', () => {
    expect(selectTasklaneLayout(sideBySideMinimumWidth)).toBe(TASKLANE_LAYOUT);
  });

  it('uses the side-by-side screen before the host is measured', () => {
    expect(selectTasklaneLayout(null)).toBe(TASKLANE_LAYOUT);
  });
});
