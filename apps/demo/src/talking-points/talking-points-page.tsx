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
  clearPlaygroundKey,
  playgroundKeyStore,
  setPlaygroundKey,
} from '../lib/playground-key-store';
import { useLivePlaybackBlocked } from '../lib/use-live-playback-blocked';
import { prepareBrowserOpenAIVoice } from '../lib/voice-adapter';
import { voiceProviderStore } from '../lib/voice-provider';
import {
  createPreparationRuntime,
  PREPARATION_LAYOUT,
  PREPARATION_VOICE_PROVIDERS,
  preparationVoiceProvider,
  type PreparationRuntime,
} from './maelstrom';
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
  useEffect(() => {
    setStore(createOutlineStore());
  }, []);
  useLayoutEffect(() => {
    if (!store) return;
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
    return () => runtime.owner.retire();
  }, [store, apiKey, browserKeyMode]);
  const showKeyError = useCallback((message: string) => {
    setKeyError(message);
    setDrawerOpen(true);
  }, []);
  const m = boundary?.m;

  return (
    <div className="talking-points-app">
      {boundary?.connector && m && store ? (
        <m.Provider
          key={boundary.sessionId}
          sessionId={boundary.sessionId}
          connector={boundary.connector}
          initialLayout={PREPARATION_LAYOUT}
        >
          <TalkingPointsHeader onRequireKey={() => setDrawerOpen(true)}>
            <VoiceProviderSelect
              useVoice={m.useVoice}
              options={PREPARATION_VOICE_PROVIDERS}
            />
          </TalkingPointsHeader>
          <PreparationWorkspace
            runtime={boundary}
            store={store}
            draft={draft}
            onDraftChange={setDraft}
            onKeyError={showKeyError}
          />
        </m.Provider>
      ) : (
        <>
          <TalkingPointsHeader onRequireKey={() => setDrawerOpen(true)}>
            <KeylessVoiceProviderSelect options={PREPARATION_VOICE_PROVIDERS} />
          </TalkingPointsHeader>
          <main className="talking-points-preview">
            <h2>Prepare your next talk</h2>
            <p>
              Create and revise an ordered outline by voice or text. Refresh to
              reuse it.
            </p>
            {store && <SavedOutline store={store} />}
            {browserKeyMode && (
              <button type="button" onClick={() => setDrawerOpen(true)}>
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
        <h1>Talking Points</h1>
        <span>Powered by Maelstrom</span>
      </div>
      <div className="talking-points-controls">
        {children}
        {usesBrowserKey() && (
          <button type="button" onClick={onRequireKey}>
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
}: {
  readonly runtime: PreparationRuntime;
  readonly store: OutlineStore;
  readonly draft: string;
  readonly onDraftChange: (text: string) => void;
  readonly onKeyError: (message: string) => void;
}) {
  const { m, owner } = runtime;
  m.usePreparationProjection();
  const { enqueueIntent, connectionStatus } = m.useMaelstrom();
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
    const ticket = enqueueIntent(text);
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
        <p role="status" aria-label={`Connection status: ${connectionStatus}`}>
          {connectionStatus}
        </p>
        <div
          className="talking-points-chart"
          style={{ height: Math.max(320, (topics.length + 1) * 160) }}
        >
          <m.Chart />
        </div>
      </main>
      <footer className="talking-points-dock">
        <div className="talking-points-voice">
          <div
            onClickCapture={() => {
              if (voice.state === 'idle' || voice.state === 'error')
                prepareBrowserOpenAIVoice();
            }}
          >
            <m.VoiceOrb size={48} />
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
              id="talking-points-intent"
              value={draft}
              onChange={(event) => changeDraft(event.target.value)}
              placeholder="Add, edit, remove or reorder Topics…"
            />
            <button type="submit" disabled={!draft.trim()}>
              Send
            </button>
          </div>
          <p role="status" aria-label="Preparation result">
            {receipt}
          </p>
        </form>
      </footer>
    </>
  );
}
