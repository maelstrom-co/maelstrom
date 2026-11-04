import type { FormEvent } from 'react';

export const TASKLANE_INTENT_EXAMPLES = [
  'Turn this feedback into tasks.',
  'Actually, group those under one parent.',
  "The pet shop isn't ready. Keep this focused on the existing demo.",
  'Assign them to me and add them to my priorities.',
  'Add a description to each of my tasks',
] as const;

export const TASKLANE_INTENT_PLACEHOLDER =
  'What would you like to do with these tasks?';

export function TasklaneIntentForm({
  intent,
  onIntentChange,
  onSubmit,
  submitLabel,
  allowEmptySubmit = false,
}: {
  readonly intent: string;
  readonly onIntentChange: (intent: string) => void;
  readonly onSubmit: () => void;
  readonly submitLabel: string;
  readonly allowEmptySubmit?: boolean;
}) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form onSubmit={handleSubmit} className="tasklane-intent-form">
      <input
        id="tasklane-intent"
        name="intent"
        type="text"
        aria-label="Ask Tasklane"
        list="tasklane-intent-examples"
        value={intent}
        onChange={(event) => onIntentChange(event.target.value)}
        placeholder={TASKLANE_INTENT_PLACEHOLDER}
        className="intent-pill min-w-0 flex-1 px-4 py-2.5"
      />
      <button
        type="submit"
        disabled={!allowEmptySubmit && !intent.trim()}
        className="btn btn-primary min-h-11 shrink-0 px-4 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitLabel}
      </button>
      <datalist id="tasklane-intent-examples">
        {TASKLANE_INTENT_EXAMPLES.map((example) => (
          <option key={example} value={example} />
        ))}
      </datalist>
    </form>
  );
}
