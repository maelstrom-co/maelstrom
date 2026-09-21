import type { InternalResponse } from '../response/response-processor.js';
import { renderRetryDiagnostics } from './retry-diagnostics.js';

/**
 * The system prompt is unchanged on retry, so the LLM still has the full
 * Vessel/Variant catalogue and Chart bounds. The generated diagnostic section
 * is centrally sanitized and bounded; `originalUserPrompt` is appended
 * byte-for-byte unchanged and is deliberately outside that diagnostic limit.
 */
export function buildRetryPrompt(
  originalUserPrompt: string,
  diagnostics: InternalResponse['diagnostics'],
): string {
  const diagnosticSection = renderRetryDiagnostics(
    diagnostics.droppedLayoutEntries,
    diagnostics.skippedActions,
    diagnostics.warnings,
  );

  const lines: string[] = [
    'The previous response had issues. Please re-issue the response addressing:',
    '',
  ];
  if (diagnosticSection.length > 0) {
    lines.push(diagnosticSection, '');
  }
  lines.push('Original request:', originalUserPrompt);
  return lines.join('\n');
}
