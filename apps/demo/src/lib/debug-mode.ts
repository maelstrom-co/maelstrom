// Grid overlays and instance-id/size labels are handy while building a
// vessel, but paint over every vessel on screen — unusable when recording
// from a plain `nx dev demo`. Opt in per-page-load instead of blanket DEV.
export function isDebugRequested(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('debug');
}
