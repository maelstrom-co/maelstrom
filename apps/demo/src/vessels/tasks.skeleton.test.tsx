// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TasksSkeleton } from './tasks.skeleton';

afterEach(cleanup);

describe('TasksSkeleton', () => {
  it('reuses the real .task-tube control for the progress placeholder, not a bespoke h-1 bar', () => {
    // The real progress tube (.task-tube) renders at 12px tall (border-box,
    // 1px borders included); a bespoke `h-1` (4px) placeholder caused an
    // ~8px layout jump when the real component mounted in its place.
    const { container } = render(<TasksSkeleton vesselId="tasks-skeleton-test" />);
    const tube = container.querySelector('.task-tube');
    expect(tube).not.toBeNull();
    expect(tube?.classList.contains('h-1')).toBe(false);
  });

  it('renders the placeholder tube with no fill child', () => {
    const { container } = render(<TasksSkeleton vesselId="tasks-skeleton-test" />);
    const tube = container.querySelector('.task-tube');
    expect(tube?.querySelector('.task-tube-fill')).toBeNull();
  });
});
