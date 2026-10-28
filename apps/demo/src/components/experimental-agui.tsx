import { SessionId } from '@maelstrom-co/protocol';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AguiConnector } from '../lib/agui-connector';
import { AguiWriteGuard } from '../lib/agui-context';
import { DEFAULT_LAYOUT } from '../lib/default-layout';
import { m } from '../lib/maelstrom';
import { playgroundKeyStore } from '../lib/playground-key-store';

export function ExperimentalAgui({ onExit }: { onExit: () => void }) {
  const [mode, setMode] = useState<'live' | 'fixture'>('live');
  const [apiKey, setApiKey] = useState(playgroundKeyStore.state.apiKey ?? '');
  const [session, setSession] = useState<{
    id: SessionId;
    connector: AguiConnector;
  } | null>(null);
  const exit = () => {
    void session?.connector.retire();
    onExit();
  };
  return (
    <div
      className="demo-shell relative z-[2]"
      style={{ gridTemplateRows: 'auto auto minmax(320px, 1fr)' }}
    >
      <header className="p-4 flex flex-wrap gap-4 items-center">
        <strong>Experimental AG-UI · typed Journal journey</strong>
        <button type="button" className="status-pill px-3 py-2" onClick={exit}>
          Return to normal demo
        </button>
      </header>
      {!session ? (
        <form
          className="p-6 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setSession({
              id: SessionId(crypto.randomUUID()),
              connector: new AguiConnector(mode, apiKey),
            });
            setApiKey('');
          }}
        >
          <p>
            Create a Journal entry, observe its generated ID, then write that ID
            into the entry.
          </p>
          <label className="block">
            Planner{' '}
            <select
              aria-label="Experimental planner"
              value={mode}
              onChange={(event) =>
                setMode(event.target.value as 'live' | 'fixture')
              }
            >
              <option value="live">
                Live model · browser-owned OpenAI key
              </option>
              <option value="fixture">
                Offline fixture · no model inference
              </option>
            </select>
          </label>
          {mode === 'live' && (
            <label className="block">
              OpenAI key{' '}
              <input
                aria-label="Experimental OpenAI key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
          )}
          <p>
            Local, memory-only, one goal per session. Reads require no approval.
            No automatic write retries.
          </p>
          <button
            type="submit"
            className="status-pill px-4 py-2"
            disabled={mode === 'live' && !apiKey.trim()}
          >
            Start experimental session
          </button>
        </form>
      ) : (
        <m.Provider
          sessionId={session.id}
          connector={session.connector}
          readyTimeoutMs={5_000}
          initialLayout={DEFAULT_LAYOUT}
        >
          <AguiWriteGuard.Provider value={session.connector.allowWrite}>
            <ExperimentalTask connector={session.connector} />
          </AguiWriteGuard.Provider>
        </m.Provider>
      )}
    </div>
  );
}

function ExperimentalTask({ connector }: { connector: AguiConnector }) {
  const orchestrator = m.useExperimentalOrchestrator();
  const { connectionStatus } = m.useMaelstrom();
  const state = useSyncExternalStore(
    connector.observe,
    connector.snapshot,
    connector.snapshot,
  );
  const [title, setTitle] = useState('Feedback-dependent Journal proof');
  const [started, setStarted] = useState(false);
  useEffect(() => connector.attach(orchestrator), [connector, orchestrator]);
  return (
    <>
      <section className="px-6 py-3 space-y-2">
        <p>
          {connector.mode === 'live'
            ? 'Live model Planner · fixed two-step journey'
            : 'Offline fixture Planner · no model inference'}
        </p>
        <form
          className="flex flex-wrap gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setStarted(true);
            void connector.runGoal(orchestrator, title.trim());
          }}
        >
          <label>
            Entry title{' '}
            <input
              aria-label="Journal entry title"
              maxLength={120}
              value={title}
              disabled={started}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="status-pill px-3 py-1"
            disabled={
              started ||
              !title.trim() ||
              connectionStatus !== 'connected' ||
              state.phase !== 'ready'
            }
          >
            Create and record generated ID
          </button>
        </form>
        <p role="status">
          {state.phase === 'stopped'
            ? 'Stopped · outcome may be unknown; inspect the Journal before any new write.'
            : state.phase === 'complete'
              ? 'Complete · dependent write observed in the application'
              : state.phase === 'annotate'
                ? 'Created · planning the dependent write'
                : started
                  ? 'Creating · waiting for application acknowledgment'
                  : `Ready · ${connectionStatus}`}
        </p>
        <p data-testid="agui-observed-id">
          Observed application ID: {state.observedId ?? 'not yet observed'}
        </p>
        <p>Acknowledged workspace revision: {state.revision}</p>
      </section>
      <main className="demo-main flex-1 relative">
        <div className="chart-wrapper">
          <m.Chart />
        </div>
      </main>
    </>
  );
}
