import type { TypedVesselProps } from '@maelstrom-co/react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { VesselCard } from '../../components/vessel-card';
import { tasklaneM } from '../maelstrom';
import {
  FEEDBACK_CHARACTER_LIMIT,
  feedbackActions,
  useFeedbackStore,
} from '../stores/feedback.store';
import { reportReplaceFeedback } from '../task-action-receipts';
import type { sourceFeedbackVessel } from './source-feedback.vessel';

export default function SourceFeedbackComponent({
  instanceId,
  executeAction,
}: TypedVesselProps<typeof sourceFeedbackVessel>) {
  const { text, truncated } = useFeedbackStore();
  const [draft, setDraft] = useState<string | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  tasklaneM.useActions('source-feedback', instanceId, {
    replaceFeedback: async ({ text: next }) =>
      reportReplaceFeedback(feedbackActions.replaceFeedback(next)),
  });

  useEffect(() => {
    if (draft !== null || !restoreFocus.current) return;
    restoreFocus.current = false;
    editButton.current?.focus();
  }, [draft]);

  const close = () => {
    restoreFocus.current = true;
    setDraft(null);
  };

  const save = () => {
    if (draft === null || draft.trim().length === 0) return;
    executeAction('replaceFeedback', { text: draft });
    close();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  return (
    <VesselCard
      accent="brand-2"
      label="Feedback"
      meta={`${text.length} characters`}
    >
      {draft === null ? (
        <>
          <section
            aria-label="Feedback snapshot"
            className="tasklane-feedback flex-1 min-h-0 overflow-y-auto"
          >
            {paragraphs(text).map((paragraph, index) => (
              <p
                key={index}
                className={
                  paragraph.startsWith('"')
                    ? 'tasklane-feedback-quote'
                    : 'tasklane-feedback-note'
                }
              >
                {paragraph}
              </p>
            ))}
          </section>
          <div className="tasklane-feedback-footer">
            {truncated ? (
              <span className="text-xs font-mono text-amber">
                Truncated to {FEEDBACK_CHARACTER_LIMIT} characters
              </span>
            ) : (
              <span />
            )}
            <button
              ref={editButton}
              type="button"
              className="tasklane-button"
              aria-label="Edit feedback"
              onClick={() => setDraft(text)}
            >
              Edit
            </button>
          </div>
        </>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col gap-2">
          <label
            htmlFor={`${instanceId}-feedback-text`}
            className="text-xs font-mono text-ink-3"
          >
            Feedback text
          </label>
          <textarea
            id={`${instanceId}-feedback-text`}
            className="tasklane-textarea flex-1 min-h-0"
            value={draft}
            maxLength={FEEDBACK_CHARACTER_LIMIT}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="tasklane-button" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="tasklane-button tasklane-button-primary"
              aria-label="Save feedback"
              disabled={draft.trim().length === 0}
              onClick={save}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </VesselCard>
  );
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}
