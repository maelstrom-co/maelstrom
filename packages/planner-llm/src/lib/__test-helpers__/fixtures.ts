import type { EngineDiagnostics } from '@maelstrom-co/engine';
import type { AnyTextAdapter } from '@tanstack/ai';

// AnyTextAdapter's phantom `~types` field has no runtime shape, so
// `satisfies` can't reproduce it — the double-cast is the only option.
export const dummyAdapter = {
  kind: 'text',
  name: 'dummy',
  model: 'dummy-model',
  chatStream: () => {
    throw new Error('dummyAdapter.chatStream not callable in tests');
  },
  structuredOutput: () => {
    throw new Error('dummyAdapter.structuredOutput not callable in tests');
  },
} as unknown as AnyTextAdapter;

/**
 * Diagnostics shaped like the Engine's for a response whose only layout
 * entry overflowed the chart: retry recommended, one drop, no actions.
 */
export const overflowDiagnostics: EngineDiagnostics = {
  retryHint: { severity: 'unrecoverable', recommend: true },
  counts: { skippedActions: 0, droppedLayoutEntries: 1, warnings: 0 },
  feedback: [
    'Layout drops:',
    '- instance "calendar-main" at (0,10) size 6x4 exceeds chart bounds (12x8)',
  ].join('\n'),
};
