import { describe, expect, test } from 'bun:test';
import type { EngineDiagnostics } from '@maelstrom-co/engine';

import { overflowDiagnostics } from './__test-helpers__/fixtures.js';
import { buildRetryPrompt } from './retry-prompt.js';

const HEADER =
  'The previous response had issues. Please re-issue the response addressing:';

const noFeedback: EngineDiagnostics = {
  retryHint: { severity: 'medium', recommend: true },
  counts: { skippedActions: 0, droppedLayoutEntries: 0, warnings: 0 },
  feedback: '',
};

describe('buildRetryPrompt', () => {
  test('empty feedback yields only the header and the original prompt', () => {
    expect(buildRetryPrompt('original', noFeedback)).toBe(
      [HEADER, '', 'Original request:', 'original'].join('\n'),
    );
  });

  test('feedback sits between the header and the original prompt', () => {
    expect(buildRetryPrompt('do the thing', overflowDiagnostics)).toBe(
      [
        HEADER,
        '',
        overflowDiagnostics.feedback,
        '',
        'Original request:',
        'do the thing',
      ].join('\n'),
    );
  });

  test('the original prompt is appended verbatim', () => {
    const original =
      'Make the chart show three panels: \n  - top: orders\n  - middle: trades\n  - bottom: positions';
    const prompt = buildRetryPrompt(original, overflowDiagnostics);

    expect(prompt).toContain('Original request:');
    expect(prompt.endsWith(original)).toBe(true);
  });
});
