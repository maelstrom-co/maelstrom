import type { TypedVesselProps } from '@maelstrom-co/react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

import { withClickMarks, withClickReceipts } from '../../lib/click-receipt';
import { cn } from '../../lib/cn';
import { tasklaneM } from '../maelstrom';
import { plural } from '../plural';
import {
  type FeedbackAttribution,
  type FeedbackCoverage,
  feedbackCoverage,
  isFeedbackQuote,
  parseFeedbackQuote,
} from '../stores/feedback-coverage';
import {
  FEEDBACK_CHARACTER_LIMIT,
  feedbackActions,
  useFeedbackStore,
} from '../stores/feedback.store';
import { useProjectTasksStore } from '../stores/project-tasks.store';
import { reportReplaceFeedback } from '../task-action-receipts';
import { tasklaneClickReceipt } from '../tasklane-activity';
import { TasklaneCard } from '../tasklane-card';
import type { sourceFeedbackVessel } from './source-feedback.vessel';

export default function SourceFeedbackComponent({
  instanceId,
  executeAction: executeVesselAction,
}: TypedVesselProps<typeof sourceFeedbackVessel>) {
  const executeAction = withClickMarks('source-feedback', executeVesselAction);
  const { text, truncated } = useFeedbackStore();
  const { tasks, removedSourceFeedback } = useProjectTasksStore();
  const [draft, setDraft] = useState<string | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  tasklaneM.useActions(
    'source-feedback',
    instanceId,
    withClickReceipts(
      'source-feedback',
      {
        replaceFeedback: async ({ text: next }) =>
          reportReplaceFeedback(feedbackActions.replaceFeedback(next)),
      },
      tasklaneClickReceipt,
    ),
  );

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
    <TasklaneCard title="Feedback" meta={`${text.length} characters`}>
      {draft === null ? (
        <>
          <section
            aria-label="Feedback snapshot"
            className="tasklane-feedback flex-1 min-h-0 overflow-y-auto"
          >
            {paragraphs(text).map((paragraph, index) => {
              if (!isFeedbackQuote(paragraph)) {
                return (
                  <p key={index} className="tasklane-feedback-note">
                    {paragraph}
                  </p>
                );
              }
              const parsed = parseFeedbackQuote(paragraph);
              return (
                <FeedbackQuote
                  key={index}
                  quote={parsed.quote}
                  attribution={parsed.attribution}
                  coverage={feedbackCoverage(
                    paragraph,
                    tasks,
                    removedSourceFeedback,
                  )}
                />
              );
            })}
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
    </TasklaneCard>
  );
}

function FeedbackQuote({
  quote,
  attribution,
  coverage,
}: {
  readonly quote: string;
  readonly attribution: FeedbackAttribution | null;
  readonly coverage: FeedbackCoverage;
}) {
  return (
    <figure data-coverage={coverage.kind} className="tasklane-feedback-card">
      <blockquote className="tasklane-feedback-quote">{quote}</blockquote>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-xs font-mono">
        {attribution ? (
          <span className="tasklane-feedback-attribution text-ink-3">
            <cite className="not-italic">{attribution.author}</cite>
            {attribution.date ? (
              <>
                {' · '}
                <time dateTime={attribution.date}>{attribution.date}</time>
              </>
            ) : null}
          </span>
        ) : null}
        <span
          className={cn(
            'tasklane-feedback-coverage',
            coverage.kind === 'covered' && 'text-green',
            coverage.kind === 'uncovered' && 'text-ink-3',
            coverage.kind === 'dropped' && 'text-amber',
          )}
        >
          {coverageText(coverage)}
        </span>
      </figcaption>
    </figure>
  );
}

function coverageText(coverage: FeedbackCoverage): string {
  switch (coverage.kind) {
    case 'covered':
      return `✓ ${plural(coverage.taskCount, 'task')}`;
    case 'uncovered':
      return '○ no task';
    case 'dropped':
      return '✕ dropped';
  }
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}
