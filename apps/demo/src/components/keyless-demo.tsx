import type { FormEvent } from 'react';
import { availableVoiceProviders } from '../lib/voice-provider';
import { useCalendarStore } from '../vessels/calendar.store';
import { useTasksStore } from '../vessels/tasks.store';
import { CAPABILITY_NOTE } from './capability-note';
import { DemoHeader } from './demo-header';
import { KeylessVoiceProviderSelect } from './voice-provider-select';
import {
  type WorkspaceProtocol,
  WorkspaceProtocolSelect,
} from './workspace-protocol-select';

interface KeylessDemoProps {
  readonly protocol: WorkspaceProtocol;
  readonly onProtocolChange: (protocol: WorkspaceProtocol) => void;
  readonly intent: string;
  readonly onIntentChange: (intent: string) => void;
  readonly onRequireKey: () => void;
  readonly onBlockedSubmit: () => void;
}

export function KeylessDemo({
  protocol,
  onProtocolChange,
  intent,
  onIntentChange,
  onRequireKey,
  onBlockedSubmit,
}: KeylessDemoProps) {
  const { events } = useCalendarStore();
  const { tasks } = useTasksStore();
  const taskItems = tasks.flatMap((task) => [task, ...task.subtasks]);
  const doneCount = taskItems.filter((task) => task.done).length;
  const progress =
    taskItems.length > 0 ? (doneCount / taskItems.length) * 100 : 0;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onBlockedSubmit();
  };

  return (
    <div className="demo-shell keyless-shell relative z-[2]">
      <DemoHeader>
        <WorkspaceProtocolSelect value={protocol} onChange={onProtocolChange} />
        <KeylessVoiceProviderSelect options={availableVoiceProviders()} />
        <button
          type="button"
          className="text-sm text-ink-2"
          onClick={onBlockedSubmit}
          aria-label="Start voice"
        >
          Voice off
        </button>
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
      </DemoHeader>

      <main className="keyless-main">
        <div className="keyless-intro dayline-intro">
          <p className="eyebrow">Sample app</p>
          <h2>Plan your day by saying what you need.</h2>
          <p>
            Dayline is a sample day planner with Maelstrom built in. Say what
            you need and Maelstrom uses Dayline's own Vessels (views) and
            Actions to do it.
          </p>
          <p className="keyless-capability-note">{CAPABILITY_NOTE}</p>
          <p>
            Add an OpenAI API key to try it. The key is sent to the demo server
            and held in memory only. It is not saved in browser storage.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onRequireKey}
          >
            Start interactive demo
          </button>
        </div>

        <section
          className="keyless-chart"
          aria-label="Example Dayline workspace"
        >
          <section className="preview-card preview-calendar">
            <div className="preview-card-heading">
              <span>
                <i className="bg-brand" />
                Day view
              </span>
              <span>Today</span>
            </div>
            {events.map((event) => (
              <div className="preview-event" key={event.id}>
                <time>{event.time}</time>
                <strong>
                  {event.location
                    ? `${event.title} - ${event.location}`
                    : event.title}
                </strong>
              </div>
            ))}
          </section>
          <section className="preview-card preview-tasks">
            <div className="preview-card-heading">
              <span>
                <i className="bg-amber" />
                Tasks
              </span>
              <span>
                {doneCount}/{taskItems.length}
              </span>
            </div>
            <div className="preview-progress">
              <span style={{ width: `${progress}%` }} />
            </div>
            <ul>
              {taskItems.map((task) => (
                <li
                  className={task.done ? 'line-through text-ink-3' : undefined}
                  key={task.id}
                >
                  {task.title}
                </li>
              ))}
            </ul>
          </section>
        </section>
      </main>

      <div className="keyless-input border-t p-3 bg-bg-1">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
          <div className="intent-row flex items-center gap-2">
            <input
              id="demo-intent"
              name="intent"
              type="text"
              value={intent}
              onChange={(event) => onIntentChange(event.target.value)}
              placeholder="What would you like to do?"
              className="intent-pill flex-1 min-w-0 px-4 py-2.5"
            />
            <button
              type="submit"
              className="btn btn-primary min-h-11 shrink-0 px-4"
            >
              Add key
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
