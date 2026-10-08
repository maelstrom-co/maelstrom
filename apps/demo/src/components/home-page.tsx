import { WireEngineError } from '@maelstrom-co/client';
import { SessionId, type TilingLayout } from '@maelstrom-co/protocol';
import { RealtimeVoiceError } from '@maelstrom-co/realtime';
import { useStore } from '@tanstack/react-store';
import {
  type ComponentType,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  sendAgentUserText,
  useAgentSessionClient,
} from '../lib/agent-session-client';
import { createDemoConnector } from '../lib/connector';
import { isDebugRequested } from '../lib/debug-mode';
import { DEFAULT_LAYOUT, NARROW_LAYOUT } from '../lib/default-layout';
import {
  type DemoMaelstrom,
  DemoMaelstromProvider,
  useDemoMaelstrom,
} from '../lib/demo-maelstrom-context';
import { STATUS_COLORS } from '../lib/design-tokens';
import { diagnosticCapture } from '../lib/diagnostic-capture';
import {
  isHosted,
  usesBrowserKey,
  usesBrowserOpenAIVoice,
} from '../lib/hosted-mode';
import { preloadHostedVadAssets } from '../lib/hosted-vad';
import {
  m as homeMaelstrom,
  prepareBrowserOpenAIVoice,
} from '../lib/maelstrom';
import {
  clearPlaygroundKey,
  playgroundKeyStore,
  setPlaygroundKey,
} from '../lib/playground-key-store';
import { useFlashInstances } from '../lib/use-touched-instances';
import { voiceProviderStore } from '../lib/voice-provider';
import { AgentSessionPanel } from './agent-session-panel';
import { AssistantResponse } from './assistant-response';
import { Captions } from './captions';
import { DemoHeader } from './demo-header';
import { FIRST_RUN_EXAMPLES, FirstRunHint } from './first-run-hint';
import { KeyDrawer } from './key-drawer';
import { KeylessDemo } from './keyless-demo';
import { RetainedCaptureDrawer } from './retained-capture-drawer';
import { VesselOptionSync } from './vessel-option-sync';
import { VoiceControl } from './voice-control';
import { VoiceDebugDrawer } from './voice-debug-drawer';
import { VoiceErrorNote } from './voice-error-note';
import { VoiceProviderSelect } from './voice-provider-select';

/**
 * True for a text-path (chart_request) failure caused by a rejected OpenAI
 * key — the browser-key analogue of the voice path's TOKEN_MINT_FAILED. The
 * wire error's `code` is the engine's `ProviderError._tag`, which covers
 * every LLM-adapter failure (network, rate limit, bad key); the message
 * text is what actually narrows it to a rejected key.
 */
function isInvalidKeyError(error: Error): boolean {
  const code = error instanceof WireEngineError ? error.code : undefined;
  if (code !== 'ProviderError') return false;
  return /\b401\b|invalid api key|incorrect api key/i.test(error.message);
}

/** What distinguishes one demo page from another; everything else is shared chrome. */
export interface DemoWorkspaceConfig {
  /** Instance whose vessel list is the Engine catalog for this page. */
  readonly maelstrom: DemoMaelstrom;
  /** Starting layout for the measured width of the page host. */
  readonly initialLayout: (hostWidth: number) => TilingLayout;
  /** Keeps the page's action option lists in step with its stores. */
  readonly OptionSync: ComponentType;
  /** Example prompts for the first-run hint and the intent suggestions. */
  readonly examples: readonly string[];
  /** Palette scoped to the page host; the default palette when omitted. */
  readonly theme?: 'shop';
  /** PROTOTYPE (MAE-825): send typed text to the server Agent Session. */
  readonly agentSession?: boolean;
}

const HOME_WORKSPACE: DemoWorkspaceConfig = {
  maelstrom: homeMaelstrom,
  initialLayout: (hostWidth) =>
    hostWidth <= 640 ? NARROW_LAYOUT : DEFAULT_LAYOUT,
  OptionSync: VesselOptionSync,
  examples: FIRST_RUN_EXAMPLES,
};

export function HomePage() {
  return <DemoWorkspace config={HOME_WORKSPACE} />;
}

/** The full demo page (key custody, voice, chart, intent dock) for one vessel catalog. */
export function DemoWorkspace({
  config,
}: Readonly<{ config: DemoWorkspaceConfig }>) {
  const hosted = isHosted();
  const browserKeyMode = usesBrowserKey();
  const apiKey = useStore(playgroundKeyStore, (state) => state.apiKey);
  // The Chart fills this host at 100% width, but its Provider needs the
  // responsive initial tree before the Chart exists to measure itself.
  const layoutHostRef = useRef<HTMLDivElement>(null);
  const [layoutHostWidth, setLayoutHostWidth] = useState<number | null>(null);
  // Bumping this forces a fresh <m.Provider key={keyEpoch}>, which remounts
  // the connector/session cleanly. useMaelstrom() exposes no public
  // disconnect(), so remount-by-key is the supported way to force a clean
  // session boundary from outside the provider tree — needed when an existing
  // key changes or is cleared.
  const [keyEpoch, setKeyEpoch] = useState(0);
  // Start closed on both server and client to keep hydration deterministic.
  // A browser-owned localhost key is memory-only, so prompt after hydration
  // whenever the local server starts without its own OpenAI key.
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    if (!hosted && browserKeyMode && playgroundKeyStore.state.apiKey === null) {
      setDrawerOpen(true);
    }
  }, [hosted, browserKeyMode]);

  useEffect(() => {
    if (!hosted || !apiKey) return;
    void preloadHostedVadAssets().catch(() => undefined);
  }, [hosted, apiKey]);

  // Lifted above <m.Provider key={keyEpoch}> so a key-save remount doesn't
  // wipe whatever the visitor already typed while the drawer was blocking
  // them — resumeIntent then carries it through to an auto-submit once the
  // fresh connection is up.
  const [intent, setIntent] = useState('');
  const [resumeIntent, setResumeIntent] = useState(false);
  const [autoStartVoice, setAutoStartVoice] = useState(false);
  // True only while the drawer is up because a Send/mic press was actually
  // blocked on a missing key — as opposed to the header "API key" button or
  // a mint-error reopen, neither of which should auto-submit whatever text
  // happens to be sitting in the box on save.
  const [blockedSubmit, setBlockedSubmit] = useState(false);

  // Populated when a browser-key voice mint fails, so the reopened drawer
  // explains why rather than looking like an unprompted reappearance.
  const [keyErrorMessage, setKeyErrorMessage] = useState<string | null>(null);
  // Stable across renders — passed as an effect dependency in DemoApp, and an
  // unstable reference there would re-fire that effect on every render while
  // voice state sits in 'error'.
  const handleMintError = useCallback((message: string) => {
    setKeyErrorMessage(message);
    setDrawerOpen(true);
  }, []);

  // One id per session boundary, shared by the Provider — which keys the
  // hosted engine and its conversation history — and the connector, which
  // sends it as the /ws session query param that IS Durable Object identity
  // (idFromName(session) in worker/index.ts). Minting them separately would
  // let the connector's routing id and the Provider's engine-keying id drift
  // apart, so a reconnect could reach a DO that has never seen the session.
  // keyEpoch is the dependency even though the factory never reads it: the
  // point is to mint a NEW id whenever the epoch bumps, which is exactly the
  // session boundary the Provider remount defines. It is not a stale dep.
  const sessionId = useMemo(() => SessionId(), [keyEpoch]);
  const initialLayout = useMemo(
    () => config.initialLayout(layoutHostWidth ?? Number.POSITIVE_INFINITY),
    [config, layoutHostWidth],
  );
  const connector = useMemo(() => {
    if (browserKeyMode && !apiKey) return null;
    return createDemoConnector({
      sessionId,
      getApiKey: () => playgroundKeyStore.state.apiKey,
    });
  }, [apiKey, browserKeyMode, sessionId]);
  useEffect(() => {
    if (connector && layoutHostWidth !== null) return;
    const layoutHost = layoutHostRef.current;
    if (!layoutHost) return;

    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width;
      if (width && width > 0) setLayoutHostWidth(width);
    });
    observer.observe(layoutHost);
    return () => observer.disconnect();
  }, [connector, layoutHostWidth]);
  const debug = useMemo(() => isDebugRequested(), []);

  return (
    <DemoMaelstromProvider value={config.maelstrom}>
      <div
        ref={layoutHostRef}
        className="demo-layout-host"
        data-demo-theme={config.theme}
      >
        {connector && layoutHostWidth !== null ? (
          <config.maelstrom.Provider
            key={keyEpoch}
            sessionId={sessionId}
            connector={connector}
            initialLayout={initialLayout}
            debug={debug}
          >
            <config.OptionSync />
            <DemoApp
              examples={config.examples}
              agentSession={config.agentSession === true}
              onRequireKey={() => setDrawerOpen(true)}
              onBlockedSubmit={() => {
                setBlockedSubmit(true);
                setDrawerOpen(true);
              }}
              onMintError={handleMintError}
              intent={intent}
              onIntentChange={setIntent}
              resumeIntent={resumeIntent}
              onResumeIntentHandled={() => setResumeIntent(false)}
              autoStartVoice={autoStartVoice}
              onAutoStartVoiceHandled={() => setAutoStartVoice(false)}
            />
          </config.maelstrom.Provider>
        ) : connector ? null : (
          <KeylessDemo
            intent={intent}
            onIntentChange={setIntent}
            onRequireKey={() => setDrawerOpen(true)}
            onBlockedSubmit={() => {
              setBlockedSubmit(true);
              setDrawerOpen(true);
            }}
          />
        )}
        {!connector && <RetainedCaptureDrawer />}
        {browserKeyMode && (
          <KeyDrawer
            isOpen={drawerOpen}
            onClose={() => {
              setDrawerOpen(false);
              setKeyErrorMessage(null);
              setBlockedSubmit(false);
            }}
            onSave={(key) => {
              // Re-entering (or merely viewing) the same key from the header
              // pill must not remount <m.Provider> mid-session — that would
              // mint a fresh sessionId and drop everything the LLM has
              // arranged so far. Only a genuine key change earns the reset.
              const keyChanged = key !== playgroundKeyStore.state.apiKey;
              const firstKey = playgroundKeyStore.state.apiKey === null;
              if (keyChanged) diagnosticCapture.stop();
              setPlaygroundKey(key);
              setDrawerOpen(false);
              setKeyErrorMessage(null);
              if (!keyChanged) {
                setBlockedSubmit(false);
                return;
              }
              setResumeIntent(blockedSubmit && intent.trim().length > 0);
              setAutoStartVoice(
                firstKey &&
                  (voiceProviderStore.state.provider === 'live' ||
                    prepareBrowserOpenAIVoice()),
              );
              setBlockedSubmit(false);
              setKeyEpoch((e) => e + 1);
            }}
            onRemove={() => {
              diagnosticCapture.stop();
              clearPlaygroundKey();
              setDrawerOpen(false);
              setKeyErrorMessage(null);
              setBlockedSubmit(false);
              setKeyEpoch((e) => e + 1);
            }}
            errorMessage={keyErrorMessage}
          />
        )}
      </div>
    </DemoMaelstromProvider>
  );
}

interface DemoAppProps {
  readonly examples: readonly string[];
  readonly agentSession: boolean;
  readonly onRequireKey: () => void;
  readonly onBlockedSubmit: () => void;
  readonly onMintError: (message: string) => void;
  readonly intent: string;
  readonly onIntentChange: (intent: string) => void;
  readonly resumeIntent: boolean;
  readonly onResumeIntentHandled: () => void;
  readonly autoStartVoice: boolean;
  readonly onAutoStartVoiceHandled: () => void;
}

function DemoApp({
  examples,
  agentSession,
  onRequireKey,
  onBlockedSubmit,
  onMintError,
  intent,
  onIntentChange,
  resumeIntent,
  onResumeIntentHandled,
  autoStartVoice,
  onAutoStartVoiceHandled,
}: DemoAppProps) {
  const m = useDemoMaelstrom();
  const { isProcessing } = m.useMaelstrom();
  const {
    state: voiceState,
    error: voiceError,
    connect: connectVoice,
  } = m.useVoice();
  const thinking = isProcessing || voiceState === 'thinking';
  const browserKeyMode = usesBrowserKey();
  const browserOpenAIVoice = usesBrowserOpenAIVoice();

  useEffect(() => {
    if (!autoStartVoice) return;
    onAutoStartVoiceHandled();
    void connectVoice().catch(() => {});
  }, [autoStartVoice, connectVoice, onAutoStartVoiceHandled]);

  // For browser-key OpenAI voice, a mint failure means the visitor's key is
  // missing or rejected, not a server misconfiguration. Reopen the drawer
  // with the mint layer's safe error text instead of VoiceErrorNote's
  // server-env copy, which does not apply without a server-side key.
  useEffect(() => {
    if (!browserOpenAIVoice || voiceState !== 'error') return;
    if (
      !(voiceError instanceof RealtimeVoiceError) ||
      voiceError.code !== 'TOKEN_MINT_FAILED'
    ) {
      return;
    }
    const { cause } = voiceError;
    onMintError(
      cause instanceof Error
        ? cause.message
        : "Voice couldn't start with that key. Check it and try again.",
    );
  }, [browserOpenAIVoice, voiceState, voiceError, onMintError]);

  return (
    <div className="demo-shell relative z-[2]">
      <DemoHeader>
        <VoiceProviderSelect />
        <VoiceDebugDrawer />
        {browserKeyMode && (
          <button
            type="button"
            onClick={onRequireKey}
            className="status-pill flex items-center gap-2 rounded-full px-3 py-1 font-mono text-xs uppercase tracking-[.1em] text-ink-2"
          >
            API key
          </button>
        )}
        <StatusIndicator />
      </DemoHeader>

      {/* Main content */}
      <main className="demo-main flex-1 relative">
        <div
          className="chart-wrapper"
          data-thinking={thinking ? 'true' : undefined}
        >
          <m.Chart />
        </div>
        <FirstRunHint examples={examples} />
        <ActionFlash />
      </main>

      {/* Compact voice and intent dock */}
      <IntentInput
        examples={examples}
        agentSession={agentSession}
        onBlockedSubmit={onBlockedSubmit}
        onMintError={onMintError}
        intent={intent}
        onIntentChange={onIntentChange}
        resumeIntent={resumeIntent}
        onResumeIntentHandled={onResumeIntentHandled}
      />
    </div>
  );
}

/**
 * Renders nothing — subscribes to the last-settled instance diff and flags
 * the corresponding `[data-instance-id]` DOM wrappers with `data-flash`
 * directly (Chart owns that DOM, not this component's React tree).
 */
function ActionFlash() {
  const m = useDemoMaelstrom();
  const touched = m.useTouchedInstances();
  useFlashInstances(touched);
  return null;
}

function StatusIndicator() {
  const m = useDemoMaelstrom();
  const { connectionStatus } = m.useMaelstrom();
  const color = STATUS_COLORS[connectionStatus];
  const statusLabel =
    connectionStatus === 'error'
      ? 'Workspace connection failed. Reload to retry.'
      : `Connection status: ${connectionStatus}`;

  return (
    <div
      className="status-pill flex items-center gap-2 rounded-full px-3 py-1 font-mono text-xs uppercase tracking-[.1em] text-ink-2"
      role="status"
      aria-label={statusLabel}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
      {connectionStatus === 'error'
        ? 'Workspace error: reload'
        : connectionStatus}
    </div>
  );
}

interface IntentInputProps {
  readonly examples: readonly string[];
  readonly agentSession: boolean;
  readonly onBlockedSubmit: () => void;
  readonly onMintError: (message: string) => void;
  readonly intent: string;
  readonly onIntentChange: (intent: string) => void;
  readonly resumeIntent: boolean;
  readonly onResumeIntentHandled: () => void;
}

function IntentInput({
  examples,
  agentSession,
  onBlockedSubmit,
  onMintError,
  intent,
  onIntentChange,
  resumeIntent,
  onResumeIntentHandled,
}: IntentInputProps) {
  const m = useDemoMaelstrom();
  const agent = useAgentSessionClient();
  const {
    processIntent,
    isProcessing: isEngineProcessing,
    lastError,
    lastResponse,
    connectionStatus,
  } = m.useMaelstrom();
  const { state: voiceState } = m.useVoice();
  const isProcessing = isEngineProcessing || (agentSession && agent.active);
  const browserKeyMode = usesBrowserKey();
  const apiKey = useStore(playgroundKeyStore, (state) => state.apiKey);
  const needsKey = browserKeyMode && !apiKey;
  // Last text actually submitted — read by the invalid-key effect below to
  // restore the draft after handleSubmit's unconditional clear, since
  // processIntent() resolving doesn't mean the request succeeded.
  const submittedIntentRef = useRef('');

  // Continues the intent the visitor already typed before the key drawer
  // interrupted them, once the post-save reconnect actually lands —
  // processIntent() throws if the socket isn't OPEN yet, so this can't fire
  // on the mere presence of a key, only once the connection reports 'connected'.
  useEffect(() => {
    if (!resumeIntent || connectionStatus !== 'connected') return;
    onResumeIntentHandled();
    if (!intent.trim() || isProcessing) return;
    // Mirrors handleSubmit's write below — the invalid-key effect restores
    // from this ref regardless of which path submitted, and the keyEpoch
    // remount that got us here already reset it to ''.
    submittedIntentRef.current = intent;
    // processIntent() never rejects (errors surface via lastError instead —
    // see useMaelstrom's contract), but a floating promise still needs a
    // .catch() as a backstop against that contract changing silently.
    void processIntent(intent)
      .then(() => onIntentChange(''))
      .catch(() => undefined);
    // Deps deliberately narrowed to [resumeIntent, connectionStatus]: intent
    // and isProcessing are read at fire time, not tracked, because
    // re-running on every keystroke would resubmit the draft.
    // (No biome-ignore here — Biome's React domain detection doesn't fire on
    // this app's "react": "catalog:" dependency, so
    // useExhaustiveDependencies never flags this effect, and a suppression
    // for a rule that isn't firing is itself flagged as an unused
    // suppression under --error-on-warnings.)
  }, [resumeIntent, connectionStatus]);

  // Text-path analogue of DemoApp's voice-mint-failure effect: a
  // chart_request that failed because OpenAI rejected the visitor's key
  // should reopen the drawer with the same actionable message the voice
  // path gets, not just leave the raw (redacted) engine error sitting under
  // the intent input. `lastError` is this hook call's own local state (see
  // useMaelstrom's contract), so this effect has to live wherever
  // processIntent() is actually called — a sibling component's lastError is
  // a different piece of state.
  useEffect(() => {
    if (!browserKeyMode || !lastError || !isInvalidKeyError(lastError)) return;
    // handleSubmit already cleared the input unconditionally (processIntent
    // never rejects) — restore what was actually submitted before reopening
    // the drawer, so the visitor doesn't lose their draft to a rejected key.
    onIntentChange(submittedIntentRef.current);
    onMintError('Invalid API key.');
  }, [browserKeyMode, lastError, onMintError, onIntentChange]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intent.trim() || isProcessing) return;
    submittedIntentRef.current = intent;
    if (needsKey) {
      onBlockedSubmit();
      return;
    }

    if (agentSession) {
      sendAgentUserText(intent);
      onIntentChange('');
      return;
    }
    await processIntent(intent);
    onIntentChange('');
  };

  // VoiceOrb owns its own click handler internally (no onClick prop) — a
  // capture-phase listener on the wrapper intercepts the click before it
  // reaches the orb's button when no key is on hand yet.
  const handleOrbClickCapture = (e: React.MouseEvent) => {
    if (!needsKey) return;
    e.preventDefault();
    e.stopPropagation();
    onBlockedSubmit();
  };

  return (
    <div
      className="connected-input relative border-t p-3 bg-bg-1"
      style={{ borderColor: 'var(--line)' }}
    >
      {agentSession ? (
        <AgentSessionPanel />
      ) : (
        <AssistantResponse
          isProcessing={isProcessing}
          message={lastResponse?.userMessage}
          voiceActive={voiceState !== 'idle' && voiceState !== 'error'}
        />
      )}
      <VoiceErrorNote />
      {/* Captions stay in footer chrome (never under main): a chart-bottom
          scrim covered vessel flash borders, and in-flow height changes here
          would fire engine chart_resize. Captions always reserves a fixed band. */}
      <Captions />
      <div className="demo-voice-band mx-auto mb-2 flex h-24 w-full max-w-4xl items-center justify-between gap-3 sm:h-12">
        <VoiceControl showOrb={false} />
        <span
          className="shrink-0 text-xs text-ink-3"
          data-testid="ai-voice-disclosure"
        >
          AI-generated voice
        </span>
      </div>
      <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
        <div className="intent-row flex items-center gap-2">
          <div onClickCapture={handleOrbClickCapture} className="mr-1 shrink-0">
            <m.VoiceOrb size={44} className="voice-orb" />
          </div>
          <input
            id="demo-intent"
            name="intent"
            type="text"
            list="demo-intent-examples"
            value={intent}
            onChange={(e) => onIntentChange(e.target.value)}
            placeholder="Tell Maelstrom what you want to arrange..."
            className="intent-pill min-w-0 flex-1 px-4 py-2.5"
            disabled={isProcessing}
          />
          <button
            type="submit"
            disabled={isProcessing || !intent.trim()}
            className="btn btn-primary min-h-11 shrink-0 px-4 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? 'Processing...' : 'Send'}
          </button>
        </div>

        <datalist id="demo-intent-examples">
          {examples.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>

        {lastError && (
          <div className="mt-2 text-sm text-pink">
            Error: {lastError.message}
          </div>
        )}
      </form>
    </div>
  );
}
