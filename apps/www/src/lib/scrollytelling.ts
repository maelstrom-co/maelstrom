/**
 * Compute the header opacity for the HowItWorks section based on scroll progress.
 * Progress is calculated as: -sectionRect.top / viewportHeight
 *
 * Timeline:
 *   progress < -0.8  → invisible (section far below)
 *   -0.8 to -0.1     → fade in
 *   -0.1 to 0.05     → fully visible
 *   0.05 to 0.2      → fade out (steps overlap)
 *   > 0.2            → invisible
 */
export function computeHeaderOpacity(progress: number): number {
  let opacity: number;
  if (progress < -0.8) {
    opacity = 0;
  } else if (progress < -0.1) {
    opacity = (progress + 0.8) / 0.7;
  } else if (progress < 0.05) {
    opacity = 1;
  } else if (progress < 0.2) {
    opacity = 1 - (progress - 0.05) / 0.15;
  } else {
    opacity = 0;
  }
  return Math.max(0, Math.min(1, opacity));
}

/**
 * Find the index of the step whose center is closest to the target Y position.
 */
export function findClosestStep(
  stepCenters: number[],
  targetY: number,
): number {
  if (stepCenters.length === 0) return -1;
  let closestIndex = 0;
  let closestDist = Infinity;

  for (let i = 0; i < stepCenters.length; i++) {
    const dist = Math.abs(stepCenters[i] - targetY);
    if (dist < closestDist) {
      closestDist = dist;
      closestIndex = i;
    }
  }

  return closestIndex;
}
