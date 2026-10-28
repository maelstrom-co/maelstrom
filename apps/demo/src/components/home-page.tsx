import {
  AguiWebSocketConnector,
  type AguiWorkspaceClient,
} from '@maelstrom-co/agui/browser';
import { SessionId } from '@maelstrom-co/protocol';
import { RealtimeVoiceError } from '@maelstrom-co/realtime';
import { useStore } from '@tanstack/react-store';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createDemoConnector } from '../lib/connector';
import { isDebugRequested } from '../lib/debug-mode';
import { DEFAULT_LAYOUT, NARROW_LAYOUT } from '../lib/default-layout';
import { STATUS_COLORS } from '../lib/design-tokens';
import { diagnosticCapture } from '../lib/diagnostic-capture';
import {
  isHosted,
  usesBrowserKey,
  usesBrowserOpenAIVoice,
} from '../lib/hosted-mode';
import { preloadHostedVadAssets } from '../lib/hosted-vad';
import { m, prepareBrowserOpenAIVoice } from '../lib/maelstrom';
import {
  clearPlaygroundKey,
  playgroundKeyStore,
  setPlaygroundKey,
} from '../lib/playground-key-store';
import { useFlashInstances } from '../lib/use-touched-instances';
import { voiceProviderStore } from '../lib/voice-provider';
import { DemoHeader } from './demo-header';
import { ExperimentalAgui } from './experimental-agui';
import { FirstRunHint } from './first-run-hint';
import { IntentInput } from './intent-input';
import { KeyDrawer } from './key-drawer';
import { KeylessDemo } from './keyless-demo';
import { VesselOptionSync } from './vessel-option-sync';
import { VoiceProviderSelect } from './voice-provider-select';
import {
  type WorkspaceProtocol,
  WorkspaceProtocolSelect,
} from './workspace-protocol-select';

export function HomePage() {
  const [experimental, setExperimental] = useState(false);
  const [protocol, setProtocol] = useState<WorkspaceProtocol>('native');
  if (experimental)
    return <ExperimentalAgui onExit={() => setExperimental(false)} />;
  return (
    <>
      {!isHosted() && (
        <button
          type="button"
          className="status-pill fixed right-4 bottom-24 z-50 px-3 py-2"
          onClick={() => setExperimental(true)}
        >
          Experimental AG-UI
        </button>
      )}
      <NormalHomePage
        key={protocol}
        protocol={protocol}
        onProtocolChange={setProtocol}
      />
    </>
  );
}

function NormalHomePage({
  protocol,
  onProtocolChange,
}: {
  protocol: WorkspaceProtocol;
  onProtocolChange: (protocol: WorkspaceProtocol) => void;
}) {
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
    () =>
      layoutHostWidth !== null && layoutHostWidth <= 640
        ? NARROW_LAYOUT
        : DEFAULT_LAYOUT,
    [layoutHostWidth],
  );
  const connector = useMemo(() => {
    if (browserKeyMode && !apiKey) return null;
    return createDemoConnector({
      sessionId,
      protocol,
      getApiKey: () => playgroundKeyStore.state.apiKey,
    });
  }, [apiKey, browserKeyMode, sessionId, protocol]);
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
    <div ref={layoutHostRef} className="demo-layout-host">
      {connector && layoutHostWidth !== null ? (
        <m.Provider
          key={keyEpoch}
          sessionId={sessionId}
          connector={connector}
          readyTimeoutMs={5_000}
          initialLayout={initialLayout}
          debug={debug}
        >
          <VesselOptionSync />
          <DemoApp
            workspace={
              connector instanceof AguiWebSocketConnector
                ? connector.workspace
                : undefined
            }
            protocol={protocol}
            onProtocolChange={onProtocolChange}
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
        </m.Provider>
      ) : connector ? null : (
        <KeylessDemo
          protocol={protocol}
          onProtocolChange={onProtocolChange}
          intent={intent}
          onIntentChange={setIntent}
          onRequireKey={() => setDrawerOpen(true)}
          onBlockedSubmit={() => {
            setBlockedSubmit(true);
            setDrawerOpen(true);
          }}
        />
      )}
      <m.Devtools />
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
  );
}

interface DemoAppProps {
  readonly workspace?: AguiWorkspaceClient;
  readonly protocol: WorkspaceProtocol;
  readonly onProtocolChange: (protocol: WorkspaceProtocol) => void;
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
  workspace,
  protocol,
  onProtocolChange,
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
        <WorkspaceProtocolSelect value={protocol} onChange={onProtocolChange} />
        {workspace && <WorkspaceProtocolError workspace={workspace} />}
        <VoiceProviderSelect />
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
        <FirstRunHint />
        <ActionFlash />
      </main>

      {/* Compact voice and intent dock */}
      <IntentInput
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

function WorkspaceProtocolError({
  workspace,
}: {
  workspace: AguiWorkspaceClient;
}) {
  const error = useSyncExternalStore(
    workspace.observe,
    workspace.snapshot,
    workspace.snapshot,
  );
  return error ? (
    <span role="alert" className="text-xs text-pink max-w-64">
      {error.message} Inspect the workspace before starting a new session.
      Switch workspace protocol or reload; do not repeat an uncertain write
      automatically.
    </span>
  ) : null;
}

/**
 * Renders nothing — subscribes to the last-settled instance diff and flags
 * the corresponding `[data-instance-id]` DOM wrappers with `data-flash`
 * directly (Chart owns that DOM, not this component's React tree).
 */
function ActionFlash() {
  const touched = m.useTouchedInstances();
  useFlashInstances(touched);
  return null;
}

function StatusIndicator() {
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
