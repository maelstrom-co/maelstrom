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
  if (keyframes.length === 0) {
    throw new Error('getCurrentKeyframe: keyframes must be non-empty');
  }
  let current = keyframes[0];
  for (const kf of keyframes) {
    if (progress >= kf.at) current = kf;
    else break;
  }
  return current;
}

/**
 * Returns the index of the keyframe active at the given progress.
 * @param keyframes Must be non-empty and sorted ascending by `at`.
 */
export function getCurrentKeyframeIndex<T extends { at: number }>(
  keyframes: T[],
  progress: number,
): number {
  if (keyframes.length === 0) {
    throw new Error('getCurrentKeyframeIndex: keyframes must be non-empty');
  }
  let index = 0;
  for (let i = 0; i < keyframes.length; i++) {
    if (progress >= keyframes[i].at) index = i;
    else break;
  }
  return index;
}
