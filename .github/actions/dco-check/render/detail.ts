import type { Verdict } from '../policy/verdict.ts';
import { EXEMPT_LABEL } from './exempt-label.ts';
import { violationReason } from './violation-reason.ts';

export function detail(verdict: Verdict): string {
  switch (verdict.state) {
    case 'violation':
      return violationReason(verdict);
    case 'exempt':
      return EXEMPT_LABEL[verdict.reason];
    case 'signed':
      return 'signed off';
    default: {
      // A new Verdict state must not silently render as a pass.
      const unhandled: never = verdict;
      return unhandled;
    }
  }
}
