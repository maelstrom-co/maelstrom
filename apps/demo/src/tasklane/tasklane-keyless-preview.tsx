import { KeylessVoiceProviderSelect } from '../components/voice-provider-select';
import { PersonChip } from './person-chip';
import { plural } from './plural';
import { useFeedbackStore } from './stores/feedback.store';
import {
  orderedTaskRows,
  useProjectTasksStore,
} from './stores/project-tasks.store';
import { TasklaneCard } from './tasklane-card';
import { TasklaneHeader } from './tasklane-header';
import { TasklaneIntentForm } from './tasklane-intent-form';
import { TASKLANE_VOICE_PROVIDERS } from './voice-providers';

const PREVIEW_QUOTE_COUNT = 3;

export function TasklaneKeylessPreview({
  intent,
  onIntentChange,
  onRequireKey,
  onBlockedSubmit,
}: {
  readonly intent: string;
  readonly onIntentChange: (intent: string) => void;
  readonly onRequireKey: () => void;
  readonly onBlockedSubmit: () => void;
}) {
  const { text } = useFeedbackStore();
  const { tasks } = useProjectTasksStore();
  const quotes = text
    .split('\n')
    .filter((line) => line.startsWith('"'))
    .slice(0, PREVIEW_QUOTE_COUNT);

  return (
    <div className="demo-shell keyless-shell relative z-[2]">
      <TasklaneHeader>
        <KeylessVoiceProviderSelect options={TASKLANE_VOICE_PROVIDERS} />
        <button
          type="button"
          onClick={onRequireKey}
          className="status-pill rounded-full px-3 py-1 font-mono text-xs uppercase tracking-[.1em] text-ink-2"
        >
          API key
        </button>
        <div
          className="status-pill flex items-center gap-2 rounded-full px-3 py-1 font-mono text-xs uppercase tracking-[.1em] text-ink-2"
          role="status"
          aria-label="Connection status: key required"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-amber" />
          Key required
        </div>
      </TasklaneHeader>

      <main className="keyless-main">
        <section className="keyless-intro" aria-label="About Tasklane">
          <p className="eyebrow">Sample app</p>
          <h2>Turn product feedback into tasks by asking.</h2>
          <p>
            Tasklane is a sample task app with Maelstrom built in. Ask it to
            turn the feedback into tasks, group them, assign them or add them to
            your priorities, or change any task by hand.
          </p>
          <p>
            Tasklane, the host app, supplies the Vessels (its views) and the
            Actions they offer. The tasks are real records in this page, not a
            live ClickUp, Jira or Todoist integration.
          </p>
          <p className="tasklane-capability-note">
            Works today: arranging Tasklane's views and running its Actions,
            like creating, grouping and assigning tasks. In development: a
            longer-running agent that plans multi-step work on its own.
          </p>
          <p>
            Add an OpenAI API key to try it. The key stays in this tab's memory
            and is never persisted.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onRequireKey}
          >
            Start interactive demo
          </button>
        </section>

        <section
          className="keyless-chart"
          aria-label="Example Tasklane project"
        >
          <TasklaneCard title="Feedback" className="preview-card">
            <ul className="tasklane-feedback grid text-sm">
              {quotes.map((quote) => (
                <li key={quote} className="tasklane-feedback-card">
                  <p className="tasklane-feedback-quote">{quote}</p>
                </li>
              ))}
            </ul>
          </TasklaneCard>
          <TasklaneCard
            title="Tasks"
            meta={plural(tasks.length, 'task')}
            className="preview-card"
          >
            <ul className="grid gap-3 text-sm">
              {orderedTaskRows(tasks).map(({ task }) => (
                <li key={task.id} className="flex justify-between gap-2">
                  <span className="min-w-0 break-words">{task.title}</span>
                  <PersonChip memberId={task.assigneeId} className="shrink-0" />
                </li>
              ))}
            </ul>
          </TasklaneCard>
        </section>
      </main>

      <div className="keyless-input tasklane-band border-t p-3">
        <div className="max-w-4xl mx-auto">
          <TasklaneIntentForm
            intent={intent}
            onIntentChange={onIntentChange}
            onSubmit={onBlockedSubmit}
            submitLabel="Add key"
            allowEmptySubmit
          />
        </div>
      </div>
    </div>
  );
}
