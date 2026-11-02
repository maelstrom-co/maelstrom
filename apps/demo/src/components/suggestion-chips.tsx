import { useId, useState } from 'react';
import { m } from '../lib/maelstrom';
import { CAPABILITY_NOTE } from './capability-note';
import { FIRST_RUN_EXAMPLES } from './first-run-hint';

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
      <fieldset className="suggestion-chips" aria-label="Suggestions">
        {!isProcessing &&
          FIRST_RUN_EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              data-suggestion
              className="suggestion-chip"
              onClick={() => fillDraft(example)}
            >
              {example}
            </button>
          ))}
      </fieldset>
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
