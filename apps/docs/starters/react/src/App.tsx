import { err, isErr, ok, type Result } from '@maelstrom-co/protocol';
import {
  createMaelstrom,
  HttpConnector,
  type TypedVesselProps,
  vessel,
} from '@maelstrom-co/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  examples,
  notesVessel,
  tasksVessel,
  workspaceLayout,
} from './workspace';

type Task = { id: string; title: string; done: boolean };
type WorkspaceData = {
  tasks: Task[];
  note: string;
  setNote: (value: string) => void;
  toggleTask: (id: string) => void;
  addTask: (title: unknown) => Result<undefined, Error>;
  issue: string | null;
  clearIssue: () => void;
};
const DataContext = createContext<WorkspaceData | null>(null);
function useData() {
  const data = useContext(DataContext);
  if (!data) throw new Error('Workspace data provider is missing');
  return data;
}

function Tasks({ instanceId }: TypedVesselProps<typeof tasksVessel>) {
  const { tasks, toggleTask, addTask } = useData();
  const [title, setTitle] = useState('');
  const runner = useMemo(
    () => ({ addTask: async ({ title }: { title: string }) => addTask(title) }),
    [addTask],
  );
  m.useActions('tasks', instanceId, runner);
  return (
    <section className="vessel tasks" aria-label="Tasks">
      <header className="vessel-header">
        <div>
          <p className="eyebrow">Your components</p>
          <h2>Tasks</h2>
        </div>
        <span className="badge">
          {tasks.filter((task) => !task.done).length} open
        </span>
      </header>
      <ul className="task-list">
        {tasks.map((task) => (
          <li key={task.id}>
            <label>
              <input
                type="checkbox"
                checked={task.done}
                onChange={() => toggleTask(task.id)}
              />
              <span className={task.done ? 'task-done' : undefined}>
                {task.title}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <form
        className="add-task"
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim() && !isErr(addTask(title))) setTitle('');
        }}
      >
        <label className="sr-only" htmlFor={`new-task-${instanceId}`}>
          New task
        </label>
        <input
          id={`new-task-${instanceId}`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={120}
          placeholder="Add a task yourself"
          required
        />
        <button type="submit" className="secondary">
          Add task
        </button>
      </form>
    </section>
  );
}

function Notes({
  instanceId,
  variantProps,
}: TypedVesselProps<typeof notesVessel>) {
  const { note, setNote } = useData();
  const editing = variantProps.variant === 'editor';
  return (
    <section className="vessel notes" aria-label="Launch note">
      <header className="vessel-header">
        <div>
          <p className="eyebrow">Two views, one note</p>
          <h2>Launch note</h2>
        </div>
        <span className="badge">{editing ? 'Editor' : 'Preview'}</span>
      </header>
      {editing ? (
        <>
          <label className="sr-only" htmlFor={`launch-note-${instanceId}`}>
            Launch note
          </label>
          <textarea
            id={`launch-note-${instanceId}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={2000}
          />
        </>
      ) : (
        <p className="note-preview">
          {note ||
            'Your note is empty. Choose “Rearrange the workspace” to open the editor.'}
        </p>
      )}
      <p className="vessel-hint">Changes stay in this tab until you reload.</p>
    </section>
  );
}

const m = createMaelstrom({
  vessels: [vessel(tasksVessel, Tasks), vessel(notesVessel, Notes)],
});
const connector = new HttpConnector({ baseUrl: '/api' });
const initialLayout = workspaceLayout();

function Workspace({ ready }: { ready: boolean }) {
  const [intent, setIntent] = useState<string>(examples[0].intent);
  const { issue, clearIssue } = useData();
  const {
    processIntent,
    connectionStatus,
    isProcessing,
    lastError,
    lastResponse,
  } = m.useMaelstrom();
  const disabled = !ready || connectionStatus !== 'connected' || isProcessing;
  const submit = (text: string) => {
    if (disabled || !text.trim()) return;
    clearIssue();
    setIntent(text);
    void processIntent(text.trim());
  };
  return (
    <>
      <form
        className="intent-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit(intent);
        }}
      >
        <label htmlFor="intent">What would help you work?</label>
        <div className="intent-row">
          <input
            id="intent"
            value={intent}
            onChange={(event) => setIntent(event.target.value)}
            maxLength={500}
            required
          />
          <button type="submit" disabled={disabled}>
            {isProcessing ? 'Updating…' : 'Send request'}
          </button>
        </div>
      </form>
      <fieldset className="examples">
        <legend className="sr-only">Example requests</legend>
        {examples.map((example) => (
          <button
            key={example.intent}
            type="button"
            className="example"
            disabled={disabled}
            onClick={() => submit(example.intent)}
          >
            {example.label}
          </button>
        ))}
      </fieldset>
      <p className="status" role="status">
        {isProcessing
          ? 'Updating your workspace…'
          : issue
            ? 'The workspace was not changed.'
            : lastError
              ? 'The local server could not complete the request. Check that it is running, then try again.'
              : (lastResponse?.userMessage ??
                'Try an example, then interact with the same components yourself.')}
      </p>
      {issue && (
        <p role="alert" className="error">
          {issue}
        </p>
      )}
      <div className="chart" aria-busy={isProcessing}>
        <m.Chart />
      </div>
    </>
  );
}

export function App() {
  const [config, setConfig] = useState<{
    mode: 'local' | 'openai';
    model?: string;
  } | null>(null);
  const [configurationError, setConfigurationError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/config', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Server configuration unavailable');
        const value: unknown = await response.json();
        if (
          !value ||
          typeof value !== 'object' ||
          !('mode' in value) ||
          (value.mode !== 'local' && value.mode !== 'openai')
        )
          throw new Error('Server configuration unavailable');
        setConfig({
          mode: value.mode,
          ...('model' in value &&
            typeof value.model === 'string' && { model: value.model }),
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setConfigurationError(true);
      });
    return () => controller.abort();
  }, []);
  const [tasks, setTasks] = useState<Task[]>([
    { id: 'layout', title: 'Try a layout change', done: false },
    { id: 'note', title: 'Edit the launch note', done: false },
  ]);
  const [note, setNote] = useState(
    'Make the first experience useful.\n\nYou design these components. Maelstrom can arrange them, switch their views, and call the actions you expose.',
  );
  const [issue, setIssue] = useState<string | null>(null);
  const taskCount = useRef(tasks.length);
  const addTask = useCallback((value: unknown): Result<undefined, Error> => {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.trim().length > 120 ||
      taskCount.current >= 100
    ) {
      const message =
        taskCount.current >= 100
          ? 'This example keeps up to 100 tasks. Reload the page to reset it.'
          : 'Use a task title between 1 and 120 characters.';
      setIssue(message);
      return err(new Error(message));
    }
    const task = { id: crypto.randomUUID(), title: value.trim(), done: false };
    taskCount.current += 1;
    setTasks((previous) => [...previous, task]);
    setIssue(null);
    return ok(undefined);
  }, []);
  const toggleTask = useCallback(
    (id: string) =>
      setTasks((previous) =>
        previous.map((task) =>
          task.id === id ? { ...task, done: !task.done } : task,
        ),
      ),
    [],
  );
  const clearIssue = useCallback(() => setIssue(null), []);
  const data = useMemo(
    () => ({ tasks, note, setNote, toggleTask, addTask, issue, clearIssue }),
    [tasks, note, toggleTask, addTask, issue, clearIssue],
  );
  return (
    <DataContext.Provider value={data}>
      <main>
        <header className="app-header">
          <p className="brand">
            Maelstrom <span>/ starter</span>
          </p>
          <span className="mode">
            {config?.mode === 'openai'
              ? `Live · OpenAI ${config.model}`
              : config
                ? 'Local walkthrough · no API key'
                : 'Connecting to the server…'}
          </span>
        </header>
        <div className="intro">
          <p className="eyebrow">A workspace you can change</p>
          <h1>Make room for the task.</h1>
          <p>
            Try a request. Your task list and note stay interactive as Maelstrom
            rearranges them.
          </p>
        </div>
        <m.Provider
          connector={connector}
          layoutMode="tiling"
          initialLayout={initialLayout}
        >
          <Workspace ready={config !== null} />
        </m.Provider>
        {configurationError && (
          <p role="alert" className="error">
            The server is unavailable. Check the terminal, then reload this
            page.
          </p>
        )}
        <footer>
          {config?.mode === 'openai'
            ? 'Live requests send your intent, recent conversation, and workspace structure to OpenAI. Each request can incur API charges.'
            : 'Local mode follows the example requests. Connect a model to use other requests. Start with the README.'}
        </footer>
      </main>
    </DataContext.Provider>
  );
}
