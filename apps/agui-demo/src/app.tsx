import {
  InstanceId,
  type TilingLayout,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { z } from 'zod';

import { GoalRunner, type WorkspaceRequest } from './browser/goal-runner';
import { m } from './browser/maelstrom';
import { VoicePanel } from './browser/voice-panel';
import { bindWorkspaceActions } from './browser/workspace-actions';
import { WorkspaceConnector } from './browser/workspace-connector';
import {
  localDate,
  WorkspaceContext,
  WorkspaceState,
} from './browser/workspace-state';
import { RecordsSchema } from './records';

const Bootstrap = z.discriminatedUnion('needsReconciliation', [
  z.object({
    needsReconciliation: z.literal(false),
    bindingId: z.string(),
    sessionId: z.string(),
    threadId: z.string(),
    records: RecordsSchema,
  }),
  z.object({
    needsReconciliation: z.literal(true),
    records: RecordsSchema,
    operations: z.array(z.unknown()),
  }),
]);
type Session = Extract<
  z.infer<typeof Bootstrap>,
  { needsReconciliation: false }
> & { state: WorkspaceState };

async function bootstrapRequest(body: unknown) {
  const response = await fetch('/api/workspace/bootstrap', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('The workspace could not be opened.');
  return Bootstrap.parse(await response.json());
}

export function App() {
  const [key, setKey] = useState('');
  const [session, setSession] = useState<Session>();
  const [review, setReview] =
    useState<
      Extract<z.infer<typeof Bootstrap>, { needsReconciliation: true }>
    >();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  async function open(reconcile = false) {
    if (opening || key.trim().length < 10) return;
    setOpening(true);
    setError('');
    try {
      const result = await bootstrapRequest({ reconcile });
      if (result.needsReconciliation) {
        setReview(result);
        setSession(undefined);
        return;
      }
      const apiKey = key.trim();
      const request: WorkspaceRequest = (path, body, signal) =>
        fetch(path, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'x-workspace-binding': result.bindingId,
            'x-openai-key': apiKey,
          },
          body: JSON.stringify(body),
          signal,
        });
      const connector = new WorkspaceConnector(async (input, signal) => {
        const response = await request(
          '/api/workspace/exchange',
          input,
          signal,
        );
        if (!response.ok) throw new Error('Workspace exchange stopped.');
        return z.array(z.unknown()).parse(await response.json());
      });
      setReview(undefined);
      setSession({
        ...result,
        state: new WorkspaceState(result.records, connector, request),
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Workspace unavailable.',
      );
    } finally {
      setOpening(false);
    }
  }
  async function reset() {
    await session?.state.connector.disconnect();
    const response = await fetch('/api/workspace/reset', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!response.ok) {
      setError('Workspace reset failed.');
      return;
    }
    setSession(undefined);
    setReview(undefined);
  }
  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <span className="eyebrow">MAELSTROM / AG-UI</span>
          <h1>Workspace</h1>
        </div>
        <div className="header-actions">
          <span className="status-badge">Local · in-memory</span>
          {(session || review) && (
            <button
              type="button"
              onClick={() => {
                void reset();
              }}
            >
              Reset workspace
            </button>
          )}
        </div>
      </header>
      {session ? (
        <Workspace
          key={session.bindingId}
          session={session}
          reconcile={() => {
            void open();
          }}
        />
      ) : (
        <main className="welcome">
          <section>
            <p className="eyebrow">SIX VESSELS. ONE GOAL.</p>
            <h2>
              A workspace that follows
              <br />
              what you need to do.
            </h2>
            <p>
              Plan a day, write a Journal entry, or work through a task.
              TanStack AI directs each step. Maelstrom arranges and applies it.
            </p>
            <div className="vessel-list">
              Calendar · Weather · Journal · Tasks · Map · Labs
            </div>
          </section>
          <section className="setup-panel">
            <h2>
              {review ? 'Inspect before continuing' : 'Open your workspace'}
            </h2>
            <p>
              Your OpenAI key stays in memory. Enter it again after a reload.
              This local build stores records in the server process.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void open(Boolean(review));
              }}
            >
              <label htmlFor="api-key">OpenAI API key</label>
              <input
                id="api-key"
                type="password"
                autoComplete="off"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder="sk-…"
                required
                minLength={10}
              />
              {review && (
                <>
                  <p>
                    The previous binding has stopped. Review the saved records
                    and operation receipts. Continuing opens fresh protocol
                    sessions and does not replay a write.
                  </p>
                  <details open>
                    <summary>Records and operations</summary>
                    <pre>
                      {JSON.stringify(
                        {
                          records: review.records,
                          operations: review.operations,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </>
              )}
              <button
                className="primary"
                type="submit"
                disabled={opening || key.trim().length < 10}
              >
                {opening
                  ? 'Opening…'
                  : review
                    ? 'Reconcile and continue'
                    : 'Open workspace'}
              </button>
            </form>
          </section>
        </main>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </div>
  );
}

function Workspace({
  session,
  reconcile,
}: {
  session: Session;
  reconcile: () => void;
}) {
  const [initialLayout] = useState<TilingLayout>(() => {
    const calendar = InstanceId('calendar-main');
    const tasks = InstanceId('tasks-main');
    return {
      type: 'tiling',
      tree: [
        window.matchMedia('(max-width: 700px)').matches ? 'H' : 'V',
        tilingLeafToken(calendar),
        tilingLeafToken(tasks),
      ],
      instances: [
        {
          instanceId: calendar,
          vesselId: VesselId('calendar'),
          variant: VariantName('day'),
        },
        {
          instanceId: tasks,
          vesselId: VesselId('tasks'),
          variant: VariantName('list'),
        },
      ],
    };
  });
  return (
    <WorkspaceContext value={session.state}>
      <m.Provider
        connector={session.state.connector}
        sessionId={session.sessionId}
        initialLayout={initialLayout}
        readyTimeoutMs={10_000}
        cellSizePx={64}
      >
        <WorkspaceBody session={session} reconcile={reconcile} />
      </m.Provider>
    </WorkspaceContext>
  );
}

function WorkspaceBody({
  session,
  reconcile,
}: {
  session: Session;
  reconcile: () => void;
}) {
  const orchestrator = m.useWorkspaceOrchestrator();
  useEffect(
    () => bindWorkspaceActions(orchestrator.commandProcessor, session.state),
    [orchestrator, session.state],
  );
  const connection = m.useMaelstrom((state) => state.connectionStatus);
  const runner = useMemo(
    () =>
      new GoalRunner(
        session.threadId,
        session.state.request,
        session.state.connector,
        orchestrator,
      ),
    [session, orchestrator],
  );
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [message, setMessage] = useState('Your workspace is ready.');
  const working = useRef(false);
  useEffect(
    () => () => {
      session.state.dispose();
      void runner.stop(false);
    },
    [runner, session],
  );
  const runGoal = useCallback(
    async (intent: string) => {
      if (working.current || stopped || connection !== 'connected')
        throw new Error('Workspace goal unavailable.');
      working.current = true;
      setBusy(true);
      try {
        const context = {
          localDate: localDate(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
        const outcome = await runner.run(
          `${intent.trim()}\n\nBrowser calendar context: ${JSON.stringify(context)}`,
          setMessage,
        );
        setMessage(outcome.message);
        setStopped(outcome.status === 'unknown');
        return outcome;
      } finally {
        working.current = false;
        setBusy(false);
      }
    },
    [connection, runner, stopped],
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!goal.trim() || busy || stopped) return;
    try {
      const outcome = await runGoal(goal);
      if (outcome.status === 'completed') setGoal('');
    } catch {
      setMessage(
        'The workspace is unavailable. Inspect and reconcile before continuing.',
      );
      setStopped(true);
    }
  }
  return (
    <>
      <main className="workspace-chart">
        <m.Chart />
      </main>
      <footer className="goal-panel">
        <div role="status" aria-live="polite" className="goal-status">
          {message}
        </div>
        {stopped || connection === 'error' ? (
          <button type="button" className="primary" onClick={reconcile}>
            Inspect and reconcile
          </button>
        ) : (
          <form
            className="goal-form"
            onSubmit={(event) => {
              void submit(event);
            }}
          >
            <label className="sr-only" htmlFor="goal">
              Workspace goal
            </label>
            <input
              id="goal"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="Create a Journal entry and write what I learned today…"
              disabled={busy}
            />
            <button
              className="primary"
              type="submit"
              disabled={busy || connection !== 'connected' || !goal.trim()}
            >
              {busy ? 'Working…' : 'Run goal'}
            </button>
          </form>
        )}
        <VoicePanel
          request={session.state.request}
          run={runGoal}
          disabled={busy || stopped || connection !== 'connected'}
        />
        <p className="goal-note">
          GPT-5.4 mini · TanStack AI 1.0 · AG-UI 1.0 · Labs contains no medical
          results
        </p>
      </footer>
    </>
  );
}
