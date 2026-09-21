import type { EngineDiagnostics } from './candidate.js';

/**
 * The system prompt is unchanged on retry, so the LLM still has the full
 * Vessel/Variant catalogue and Chart bounds. The diagnostic section is the
 * Engine's `feedback`, sanitized and bounded when it was rendered;
 * `originalUserPrompt` is appended byte-for-byte unchanged and is
 * deliberately outside that diagnostic limit.
 */
export function buildRetryPrompt(
  originalUserPrompt: string,
  diagnostics: EngineDiagnostics,
): string {
  const lines: string[] = [
    'The previous response had issues. Please re-issue the response addressing:',
    '',
  ];
  if (diagnostics.feedback.length > 0) {
    lines.push(diagnostics.feedback, '');
  }
  lines.push('Original request:', originalUserPrompt);
  return lines.join('\n');
}
