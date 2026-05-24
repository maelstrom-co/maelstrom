import { useEffect, useState } from 'react';

const MOBILE_QUERY = '(max-width: 980px)';

/**
 * Tracks whether the viewport is at/below the mobile breakpoint (≤980px). Shared
 * by the hero and demo islands so both switch to single-column layouts at the
 * same width. SSR-safe: false during SSR (no `window`); from the first client
 * render onward it reports the actual breakpoint.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}
