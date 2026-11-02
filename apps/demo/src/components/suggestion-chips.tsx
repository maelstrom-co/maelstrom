import { useId, useState } from 'react';

import { m } from '../lib/maelstrom';
import { CAPABILITY_NOTE } from './capability-note';
import { FIRST_RUN_EXAMPLES } from './first-run-hint';

const SUGGESTIONS = [
  { label: 'Add a design review task', prompt: FIRST_RUN_EXAMPLES[0] },
  { label: 'Write a journal entry', prompt: FIRST_RUN_EXAMPLES[1] },
  { label: 'Move the design review', prompt: FIRST_RUN_EXAMPLES[2] },
] as const;

interface SuggestionChipsProps {
  readonly onIntentChange: (intent: string) => void;
}

interface SuggestionChipBandProps extends SuggestionChipsProps {
  readonly isProcessing: boolean;
}

export function SuggestionChips({ onIntentChange }: SuggestionChipsProps) {
  const { isProcessing } = m.useMaelstrom();
  return (
    <SuggestionChipBand
      isProcessing={isProcessing}
      onIntentChange={onIntentChange}
    />
  );
}

/**
 * The band keeps one fixed height whether or not chips show, because any
 * height change would resize the Chart and start a new `chart_resize` request.
 */
export function SuggestionChipBand({
  isProcessing,
  onIntentChange,
}: SuggestionChipBandProps) {
  const noteId = useId();
  const [noteOpen, setNoteOpen] = useState(false);

  const fillDraft = (example: string) => {
    onIntentChange(example);
    document.getElementById('demo-intent')?.focus();
  };

  return (
    <div data-testid="suggestion-chip-band" className="suggestion-chip-band">
      <ul className="suggestion-chips" aria-label="Suggestions">
        {!isProcessing &&
          SUGGESTIONS.map(({ label, prompt }) => (
            <li key={label}>
              <button
                type="button"
                data-suggestion
                className="suggestion-chip"
                title={prompt}
                onClick={() => fillDraft(prompt)}
              >
                {label}
              </button>
            </li>
          ))}
      </ul>
      <div className="capability-note">
        <button
          type="button"
          className="capability-note-info"
          aria-label="What you can do"
          aria-describedby={noteId}
          aria-expanded={noteOpen}
          onClick={() => setNoteOpen((open) => !open)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setNoteOpen(false);
          }}
          onBlur={() => setNoteOpen(false)}
        >
          i
        </button>
        <p
          id={noteId}
          className="capability-note-text"
          data-open={noteOpen ? 'true' : undefined}
        >
          {CAPABILITY_NOTE}
        </p>
      </div>
    </div>
  );
}
