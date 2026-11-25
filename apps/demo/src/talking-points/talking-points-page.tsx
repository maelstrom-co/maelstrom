import { SessionId } from '@maelstrom-co/protocol';
import { RealtimeVoiceError } from '@maelstrom-co/realtime';
import { useStore } from '@tanstack/react-store';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { EnablePlaybackButton } from '../components/enable-playback-button';
import { HoldToTalkControl } from '../components/hold-to-talk-control';
import { KeyDrawer } from '../components/key-drawer';
import {
  KeylessVoiceProviderSelect,
  VoiceProviderSelect,
} from '../components/voice-provider-select';
import { createDemoConnector } from '../lib/connector';
import { usesBrowserKey } from '../lib/hosted-mode';
import {
  isInvalidKeyError,
  isLiveInvalidKeyError,
} from '../lib/invalid-key-error';
import {
  createBrowserMintTranscriptionToken,
  mintOpenAITranscriptionToken,
} from '../lib/mint-token';
import {
  clearPlaygroundKey,
  playgroundKeyStore,
  setPlaygroundKey,
} from '../lib/playground-key-store';
import { useLivePlaybackBlocked } from '../lib/use-live-playback-blocked';
import { prepareBrowserOpenAIVoice } from '../lib/voice-adapter';
import { voiceProviderStore } from '../lib/voice-provider';
import { createLiveTake, type LiveTake } from './live-take';
import { LiveTranscript } from './live-transcript';
import {
  createPreparationRuntime,
  PREPARATION_LAYOUT,
  PREPARATION_VOICE_PROVIDERS,
  preparationVoiceProvider,
  type PreparationRuntime,
} from './maelstrom';
import { createLiveRuntime, type LiveRuntime } from './maelstrom';
import { createOutlineStore, type OutlineStore } from './outline.store';

import './talking-points.css';

type Boundary = PreparationRuntime & {
  sessionId: SessionId;
  connector: ReturnType<typeof createDemoConnector> | null;
};

export function TalkingPointsPage() {
  const apiKey = useStore(playgroundKeyStore, (state) => state.apiKey);
  const browserKeyMode = usesBrowserKey();
  const [store, setStore] = useState<OutlineStore | null>(null);
  const [boundary, setBoundary] = useState<Boundary | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [live, setLive] = useState<
    | (LiveRuntime & {
        take: LiveTake;
        sessionId: SessionId;
        connector: ReturnType<typeof createDemoConnector>;
      })
    | null
  >(null);
  const [generation, setGeneration] = useState(0);
  const [sealing, setSealing] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const currentTake = useRef<LiveTake | null>(null);
  const activeLiveRuntime = useRef<LiveRuntime | null>(null);
  const isLive = live !== null;
  useLayoutEffect(() => () => currentTake.current?.dispose(), []);
  useLayoutEffect(() => {
    activeLiveRuntime.current = live;
    return () => {
      activeLiveRuntime.current = null;
      // Effect replay can reuse this runtime before permanent retirement.
      if (live)
        queueMicrotask(() => {
          if (activeLiveRuntime.current !== live) live.m.disposeDevtools();
        });
    };
  }, [live]);
  useEffect(() => {
    setStore(createOutlineStore());
  }, []);
  useLayoutEffect(() => {
    if (!store || isLive) {
      setBoundary(null);
      return;
    }
    const runtime = createPreparationRuntime(
      store,
      preparationVoiceProvider(voiceProviderStore.state.provider),
    );
    const sessionId = SessionId(runtime.owner.generation);
    const connector =
      browserKeyMode && !apiKey
        ? null
        : createDemoConnector({
            sessionId,
            getApiKey: () => playgroundKeyStore.state.apiKey,
          });
    setBoundary({ ...runtime, sessionId, connector });
    setSealing(false);
    return () => {
      runtime.owner.retire();
      runtime.admission.retire();
      runtime.m.disposeDevtools();
    };
  }, [store, apiKey, browserKeyMode, generation, isLive]);
  const showKeyError = useCallback((message: string) => {
    setKeyError(message);
    setDrawerOpen(true);
  }, []);
  const m = boundary?.m;
  const enterLive = () => {
    if (!store || !boundary?.owner.isActive()) return;
    if (!store.getSnapshot().topics.length) {
      boundary.owner.retire();
      boundary.admission.retire();
      setStartError('Add at least one Topic before starting a take.');
      setSealing(false);
      setGeneration((value) => value + 1);
      return;
    }
    boundary.owner.retire();
    boundary.admission.retire();
    let runtime: LiveRuntime | undefined;
    const sessionId = SessionId(crypto.randomUUID());
    const take = createLiveTake({
      topics: store.getSnapshot().topics,
      mintToken: browserKeyMode
        ? createBrowserMintTranscriptionToken(
            () => playgroundKeyStore.state.apiKey,
          )
        : (signal) => mintOpenAITranscriptionToken(sessionId, signal),
      retirePending: () => runtime?.retirePending(),
    });
    runtime = createLiveRuntime(take);
    currentTake.current = take;
    setLive({
      ...runtime,
      take,
      sessionId,
      connector: createDemoConnector({
        sessionId,
        getApiKey: () => playgroundKeyStore.state.apiKey,
      }),
    });
    void take.start(runtime.engineReady);
  };
  const Devtools = (live?.m ?? m)?.Devtools;
  return (
    <>
      {live ? (
        <LiveWorkspace
          runtime={live}
          onReset={() => {
            live.take.reset();
            currentTake.current = null;
            setLive(null);
            setSealing(false);
            setGeneration((value) => value + 1);
          }}
        />
      ) : (
        <div className="talking-points-app">
          {boundary?.connector && m && store ? (
            <m.Provider
              key={boundary.sessionId}
              sessionId={boundary.sessionId}
              connector={boundary.connector}
              initialLayout={PREPARATION_LAYOUT}
            >
              <TalkingPointsHeader onRequireKey={() => setDrawerOpen(true)}>
                {!sealing && (
                  <VoiceProviderSelect
                    useVoice={m.useVoice}
                    options={PREPARATION_VOICE_PROVIDERS}
                  />
                )}
              </TalkingPointsHeader>
              {startError && <p role="alert">{startError}</p>}
              <PreparationWorkspace
                runtime={boundary}
                store={store}
                draft={draft}
                onDraftChange={setDraft}
                onKeyError={showKeyError}
                sealing={sealing}
                onSeal={() => {
                  setStartError(null);
                  setSealing(true);
                }}
                onStart={enterLive}
                onCancelStart={() => {
                  boundary.owner.retire();
                  boundary.admission.retire();
                  setSealing(false);
                  setGeneration((value) => value + 1);
                }}
                onStartFailed={() => {
                  boundary.owner.retire();
                  boundary.admission.retire();
                  setStartError(
                    'Preparation did not settle successfully. Start was stopped; check your outline before trying again.',
                  );
                  setSealing(false);
                  setGeneration((value) => value + 1);
                }}
              />
            </m.Provider>
          ) : (
            <>
              <TalkingPointsHeader onRequireKey={() => setDrawerOpen(true)}>
                <KeylessVoiceProviderSelect
                  options={PREPARATION_VOICE_PROVIDERS}
                />
              </TalkingPointsHeader>
              <main className="talking-points-preview">
                <h2>Prepare your next talk</h2>
                <p>
                  Create and revise an ordered outline by voice or text. Refresh
                  to reuse it.
                </p>
                {store && <SavedOutline store={store} />}
                {browserKeyMode && (
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => setDrawerOpen(true)}
                  >
                    Add an API key to prepare
                  </button>
                )}
              </main>
            </>
          )}
          {browserKeyMode && (
            <KeyDrawer
              isOpen={drawerOpen}
              onClose={() => {
                setDrawerOpen(false);
                setKeyError(null);
              }}
              onSave={(key) => {
                if (key !== playgroundKeyStore.state.apiKey)
                  boundary?.owner.retire();
                setPlaygroundKey(key);
                setDrawerOpen(false);
                setKeyError(null);
              }}
              onRemove={() => {
                boundary?.owner.retire();
                clearPlaygroundKey();
                setDrawerOpen(false);
                setKeyError(null);
              }}
              errorMessage={keyError}
            />
          )}
        </div>
      )}
      {Devtools && <Devtools />}
    </>
  );
}

function TalkingPointsHeader({
  children,
  onRequireKey,
}: {
  readonly children: ReactNode;
  readonly onRequireKey: () => void;
}) {
  return (
    <header className="talking-points-header">
      <div>
        <a href="/">← Dayline</a>
        <h1 className="eyebrow">Talking Points</h1>
        <a className="powered-by-badge" href="https://maelstrom-ai.co">
          <img
            src="/brand/powered-by-badge-dark.svg"
            alt="Powered by Maelstrom"
            width={135}
            height={28}
          />
        </a>
      </div>
      <div className="talking-points-controls">
        {children}
        {usesBrowserKey() && (
          <button
            className="btn btn-ghost"
            type="button"
            onClick={onRequireKey}
          >
            API key
          </button>
        )}
      </div>
    </header>
  );
}

function SavedOutline({ store }: { readonly store: OutlineStore }) {
  const { topics } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return topics.length ? (
    <ol>
      {topics.map((topic) => (
        <li key={topic.id}>{topic.content}</li>
      ))}
    </ol>
  ) : null;
}

function PreparationWorkspace({
  runtime,
  store,
  draft,
  onDraftChange,
  onKeyError,
  sealing,
  onSeal,
  onStart,
  onStartFailed,
  onCancelStart,
}: {
  readonly runtime: PreparationRuntime;
  readonly store: OutlineStore;
  readonly draft: string;
  readonly onDraftChange: (text: string) => void;
  readonly onKeyError: (message: string) => void;
  readonly sealing: boolean;
  readonly onSeal: () => void;
  readonly onStart: () => void;
  readonly onStartFailed: () => void;
  readonly onCancelStart: () => void;
}) {
  const { m, owner } = runtime;
  m.usePreparationProjection();
  const { connectionStatus } = m.useMaelstrom();
  const intake = m.usePreparationIntake();
  const voice = m.useVoice();
  const { topics } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [receipt, setReceipt] = useState('');
  const revision = useRef(0);
  const submissionNumber = useRef(0);
  const playbackBlocked = useLivePlaybackBlocked(voice.session);
  useEffect(() => {
    if (voice.state !== 'error') return;
    if (
      isLiveInvalidKeyError(voice.error) ||
      (voice.error instanceof RealtimeVoiceError &&
        voice.error.code === 'TOKEN_MINT_FAILED')
    )
      onKeyError('Voice could not start. Check your API key and try again.');
  }, [voice.state, voice.error, onKeyError]);
  const changeDraft = (text: string) => {
    revision.current++;
    onDraftChange(text);
  };
  const submit = () => {
    const text = draft.trim();
    if (!text || !owner.isActive()) return;
    const ticket = intake.enqueueIntent(text);
    const number = ++submissionNumber.current;
    if (ticket.accepted) changeDraft('');
    const submittedRevision = revision.current;
    setReceipt(
      ticket.accepted ? 'Queued…' : 'Not submitted. Try again when connected.',
    );
    void ticket.result.then((result) => {
      if (!owner.isActive() || number !== submissionNumber.current) return;
      switch (result.status) {
        case 'applied':
          setReceipt(result.response.userMessage || 'Outline prepared.');
          break;
        case 'not_submitted':
          setReceipt('Not submitted. You can try again.');
          if (revision.current === submittedRevision) changeDraft(text);
          break;
        case 'failed':
        case 'unknown':
          setReceipt(
            result.status === 'unknown'
              ? 'Outcome not confirmed. Check your outline before trying again.'
              : 'Preparation failed. Check your outline.',
          );
          if (usesBrowserKey() && isInvalidKeyError(result.error))
            onKeyError('Invalid API key.');
          break;
      }
    });
  };
  return (
    <>
      <main className="talking-points-main">
        <div className="talking-points-toolbar">
          <p
            className="status-pill"
            role="status"
            aria-label={`Connection status: ${connectionStatus}`}
          >
            {connectionStatus}
          </p>
          <button
            className="btn btn-primary"
            type="button"
            disabled={
              sealing || !topics.length || connectionStatus !== 'connected'
            }
            onClick={() => {
              onSeal();
              setReceipt(
                'Starting: waiting for accepted preparation to settle…',
              );
              void runtime.admission
                .seal()
                .then(async () => {
                  if (!owner.isActive()) return;
                  await voice.disconnect();
                  if (owner.isActive()) onStart();
                })
                .catch(() => {
                  if (!owner.isActive()) return;
                  setReceipt(
                    'Preparation outcome not confirmed. Start was stopped; check your outline before trying again.',
                  );
                  onStartFailed();
                });
            }}
          >
            Start take
          </button>
          {sealing && (
            <button
              className="btn btn-ghost"
              type="button"
              onClick={onCancelStart}
            >
              Reset
            </button>
          )}
          {sealing && (
            <p role="status">Starting: waiting for preparation to settle…</p>
          )}
        </div>
        <div
          className="talking-points-chart"
          style={{
            height: `calc(${topics.length + 1} * var(--talking-points-row-height))`,
          }}
        >
          <m.Chart />
        </div>
      </main>
      {!sealing && (
        <footer className="talking-points-dock">
          <div className="talking-points-voice">
            <div
              onClickCapture={() => {
                if (voice.state === 'idle' || voice.state === 'error')
                  prepareBrowserOpenAIVoice();
              }}
            >
              <m.VoiceOrb size={44} />
            </div>
            <span role="status" aria-label="Voice status">
              {voice.state === 'idle' ? 'Tap to talk' : voice.state}
            </span>
            <span>AI-generated voice</span>
            <HoldToTalkControl
              state={voice.state}
              turnControl={voice.turnControl}
              turnMode={voice.turnMode}
              turnModeError={voice.turnModeError}
            />
            {playbackBlocked && (
              <EnablePlaybackButton
                provider={voice.provider}
                state={voice.state}
                session={voice.session}
                switching={voice.switching}
              />
            )}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <label htmlFor="talking-points-intent">Prepare your outline</label>
            <div className="talking-points-input-row">
              <input
                className="intent-pill"
                id="talking-points-intent"
                value={draft}
                onChange={(event) => changeDraft(event.target.value)}
                placeholder="Add, edit, remove or reorder Topics…"
              />
              <button
                className="btn btn-primary"
                type="submit"
                disabled={!draft.trim()}
              >
                Send
              </button>
            </div>
            <p role="status" aria-label="Preparation result">
              {receipt}
            </p>
          </form>
        </footer>
      )}
    </>
  );
}

function LiveEngineStatus({ runtime }: { readonly runtime: LiveRuntime }) {
  const connectionStatus = runtime.m.useMaelstrom(
    (state) => state.connectionStatus,
  );
  return (
    <p role="status" aria-label="Engine connection status">
      Engine: {connectionStatus}
    </p>
  );
}

function LiveWorkspace({
  runtime,
  onReset,
}: {
  readonly runtime: LiveRuntime & {
    take: LiveTake;
    sessionId: SessionId;
    connector: ReturnType<typeof createDemoConnector>;
  };
  readonly onReset: () => void;
}) {
  const { m, take } = runtime;
  const snapshot = useSyncExternalStore(
    take.subscribe,
    take.getSnapshot,
    take.getSnapshot,
  );
  const seconds = Math.floor(snapshot.elapsedMs / 1000);
  return (
    <div className="talking-points-app">
      <main className="talking-points-main">
        <h1 className="eyebrow">Talking Points</h1>
        <div className="talking-points-take-controls">
          <output aria-label="Elapsed time">
            {String(Math.floor(seconds / 60)).padStart(2, '0')}:
            {String(seconds % 60).padStart(2, '0')}
          </output>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={
              snapshot.phase !== 'listening' && snapshot.phase !== 'starting'
            }
            onClick={() => take.stop()}
          >
            Stop
          </button>
          <button className="btn btn-ghost" type="button" onClick={onReset}>
            Reset
          </button>
        </div>
        <p className="status-pill" role="status" aria-label="Take status">
          {snapshot.phase === 'starting'
            ? 'Starting…'
            : snapshot.phase === 'listening'
              ? 'Listening'
              : snapshot.phase === 'finalizing'
                ? 'Finalizing…'
                : 'Stopped · Reset before another take'}
        </p>
        {snapshot.error && <p role="alert">{snapshot.error}</p>}
        {snapshot.warning && <p role="status">{snapshot.warning}</p>}
        <m.Provider
          sessionId={runtime.sessionId}
          connector={runtime.connector}
          initialLayout={runtime.layout}
          onError={runtime.engineFailed}
        >
          <LiveEngineStatus runtime={runtime} />
          <div
            className="talking-points-chart"
            style={{
              height: `calc(${Math.max(1, snapshot.topics.length)} * var(--talking-points-row-height))`,
            }}
          >
            <m.Chart />
          </div>
        </m.Provider>
        <LiveTranscript take={take} />
      </main>
    </div>
  );
}
