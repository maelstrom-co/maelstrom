export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Returns the keyframe active at the given progress.
 * @param keyframes Must be non-empty and sorted ascending by `at`.
 */
export function getCurrentKeyframe<T extends { at: number }>(
  keyframes: T[],
  progress: number,
): T {
  let current = keyframes[0];
  for (const kf of keyframes) {
    if (progress >= kf.at) current = kf;
    else break;
  }
  return current;
}

export function getCurrentKeyframeIndex<T extends { at: number }>(
  keyframes: T[],
  progress: number,
): number {
  let index = 0;
  for (let i = 0; i < keyframes.length; i++) {
    if (progress >= keyframes[i].at) index = i;
    else break;
  }
  return index;
}
