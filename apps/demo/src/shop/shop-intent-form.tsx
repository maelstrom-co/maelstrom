import type { FormEvent } from 'react';

export const SHOP_INTENT_EXAMPLES = [
  'show the catalog',
  'reorder my dog food but with less fat',
  'check out',
] as const;

export const SHOP_INTENT_PLACEHOLDER = 'Tell Maelstrom what you need...';

export function ShopIntentForm({
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
    <form onSubmit={handleSubmit} className="shop-intent-form">
      <input
        name="intent"
        type="text"
        aria-label="Ask the pet shop"
        list="shop-intent-examples"
        value={intent}
        onChange={(event) => onIntentChange(event.target.value)}
        placeholder={SHOP_INTENT_PLACEHOLDER}
        className="intent-pill min-w-0 flex-1 px-4 py-2.5"
      />
      <button
        type="submit"
        disabled={!allowEmptySubmit && !intent.trim()}
        className="btn btn-primary min-h-11 shrink-0 px-4 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitLabel}
      </button>
      <datalist id="shop-intent-examples">
        {SHOP_INTENT_EXAMPLES.map((example) => (
          <option key={example} value={example} />
        ))}
      </datalist>
    </form>
  );
}
