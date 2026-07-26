import { m } from '../lib/maelstrom';

/** Hand-picked example prompts, shown in the first-run hint and echoed as suggestion chips so text and voice paths teach the same vocabulary. */
export const FIRST_RUN_EXAMPLES = [
  'Clear all this — just show me today',
  "What's my morning look like? I need to be at the design review by 10",
  "Start a journal entry about today's plan and jot down the key points",
] as const;

/** Pure so the empty-chart threshold can be unit-tested without mounting a Provider. */
export function isFirstRunHintVisible(instanceCount: number, isProcessing: boolean): boolean {
  return instanceCount === 0 && !isProcessing;
}

/**
 * Centered hint shown in place of an empty chart — replaces silence with a
 * few concrete things to say, matched to what the suggestion chips offer.
 */
export function FirstRunHint() {
  const instanceCount = m.useInstanceCount();
  const { isProcessing } = m.useMaelstrom();

  if (!isFirstRunHintVisible(instanceCount, isProcessing)) return null;

  return (
    <div
      data-testid="first-run-hint"
      className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center"
    >
      <div className="max-w-md rounded-2xl border border-gray-700 bg-gray-800/60 px-8 py-6 text-center backdrop-blur-sm">
        <p className="text-sm font-medium text-gray-400">Try saying…</p>
        <ul className="mt-3 space-y-2">
          {FIRST_RUN_EXAMPLES.map((example) => (
            <li key={example} className="text-sm text-gray-200">
              &ldquo;{example}&rdquo;
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-gray-500">
          Type below, press Enter, or tap the orb to speak
        </p>
      </div>
    </div>
  );
}
