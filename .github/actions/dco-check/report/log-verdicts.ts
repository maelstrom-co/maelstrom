import type { Verdict } from '../policy/verdict.ts';
import type { Violation } from '../policy/violation.ts';
import { renderLogTable } from '../render/render-log-table.ts';
import { shortSha } from '../render/short-sha.ts';
import { violationReason } from '../render/violation-reason.ts';
import { annotateError } from './annotate-error.ts';

export function logVerdicts(verdicts: Verdict[]): void {
  console.log('::group::DCO verdicts');
  console.log(renderLogTable(verdicts));
  console.log('::endgroup::');
  for (const verdict of verdicts) {
    if (isViolation(verdict)) {
      annotateError(`${shortSha(verdict.commit)} ${violationReason(verdict)}`);
    }
  }
}

function isViolation(verdict: Verdict): verdict is Violation {
  return verdict.state === 'violation';
}
