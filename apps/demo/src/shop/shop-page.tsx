import type { IntentSubmission } from '@maelstrom-co/client';
import { SessionId } from '@maelstrom-co/protocol';
import { RealtimeVoiceError } from '@maelstrom-co/realtime';
import { useStore } from '@tanstack/react-store';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { KeyDrawer } from '../components/key-drawer';
import { VoiceProviderSelect } from '../components/voice-provider-select';
import { createDemoConnector } from '../lib/connector';
import { isDebugRequested } from '../lib/debug-mode';
import { STATUS_COLORS } from '../lib/design-tokens';
import { diagnosticCapture } from '../lib/diagnostic-capture';
import {
  isHosted,
  usesBrowserKey,
  usesBrowserOpenAIVoice,
} from '../lib/hosted-mode';
import { preloadHostedVadAssets } from '../lib/hosted-vad';
import {
  isInvalidKeyError,
  isLiveInvalidKeyError,
} from '../lib/invalid-key-error';
import { liveErrorMessage } from '../lib/live-exchange';
import {
  clearPlaygroundKey,
  playgroundKeyStore,
  setPlaygroundKey,
} from '../lib/playground-key-store';
import { prepareBrowserOpenAIVoice } from '../lib/voice-adapter';
import { voiceProviderStore } from '../lib/voice-provider';
import { selectShopLayout } from './default-layout';
import { shopM } from './maelstrom';
import { ShopHeader } from './shop-header';
import { ShopIntentForm } from './shop-intent-form';
import { ShopKeylessPreview } from './shop-keyless-preview';
import { ShopOptionSync } from './shop-option-sync';
import { ShopVoiceCorner } from './shop-voice-corner';
import { SHOP_VOICE_PROVIDERS, shopVoiceProvider } from './voice-providers';
import './shop.css';

export function ShopPage() {
  const hosted = isHosted();
  const browserKeyMode = usesBrowserKey();
  const apiKey = useStore(playgroundKeyStore, (state) => state.apiKey);
  const layoutHostRef = useRef<HTMLDivElement>(null);
  const [layoutHostWidth, setLayoutHostWidth] = useState<number | null>(null);
  // Remounting the Provider by key is the supported way to force a clean
  // session boundary when the key changes or is cleared.
  const [keyEpoch, setKeyEpoch] = useState(0);
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

  const [intent, setIntent] = useState('');
  const [resumeIntent, setResumeIntent] = useState(false);
  const [autoStartVoice, setAutoStartVoice] = useState(false);
  const [blockedSubmit, setBlockedSubmit] = useState(false);
  const [keyErrorMessage, setKeyErrorMessage] = useState<string | null>(null);
  const handleMintError = useCallback((message: string) => {
    setKeyErrorMessage(message);
    setDrawerOpen(true);
  }, []);
  const requireKey = useCallback(() => setDrawerOpen(true), []);
  const handleBlockedSubmit = useCallback(() => {
    setBlockedSubmit(true);
    setDrawerOpen(true);
  }, []);

  // The Provider and the connector must share one id per session boundary,
  // and keyEpoch is the dependency so a new epoch mints a new id.
  const sessionId = useMemo(() => SessionId(), [keyEpoch]);
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
  const initialLayout = useMemo(
    () => selectShopLayout(layoutHostWidth),
    [layoutHostWidth],
  );

  return (
    <div ref={layoutHostRef} className="demo-layout-host shop-app">
      {connector && layoutHostWidth !== null ? (
        <shopM.Provider
          key={keyEpoch}
          sessionId={sessionId}
          connector={connector}
          initialLayout={initialLayout}
          debug={debug}
        >
          <ShopOptionSync />
          <ShopWorkspace
            onRequireKey={requireKey}
            onBlockedSubmit={handleBlockedSubmit}
            onMintError={handleMintError}
            intent={intent}
            onIntentChange={setIntent}
            resumeIntent={resumeIntent}
            onResumeIntentHandled={() => setResumeIntent(false)}
            autoStartVoice={autoStartVoice}
            onAutoStartVoiceHandled={() => setAutoStartVoice(false)}
          />
        </shopM.Provider>
      ) : connector ? null : (
        <ShopKeylessPreview
          intent={intent}
          onIntentChange={setIntent}
          onRequireKey={requireKey}
          onBlockedSubmit={handleBlockedSubmit}
        />
      )}
      <shopM.Devtools />
      {browserKeyMode && (
        <KeyDrawer
          isOpen={drawerOpen}
          onClose={() => {
            setDrawerOpen(false);
            setKeyErrorMessage(null);
            setBlockedSubmit(false);
          }}
          onSave={(key) => {
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
                (shopVoiceProvider(voiceProviderStore.state.provider) ===
                  'live' ||
                  prepareBrowserOpenAIVoice()),
            );
            setBlockedSubmit(false);
            setKeyEpoch((epoch) => epoch + 1);
          }}
          onRemove={() => {
            diagnosticCapture.stop();
            clearPlaygroundKey();
            setDrawerOpen(false);
            setKeyErrorMessage(null);
            setBlockedSubmit(false);
            setKeyEpoch((epoch) => epoch + 1);
          }}
          errorMessage={keyErrorMessage}
        />
      )}
    </div>
  );
}

interface ShopWorkspaceProps {
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

function ShopWorkspace({
  onRequireKey,
  onBlockedSubmit,
  onMintError,
  intent,
  onIntentChange,
  resumeIntent,
  onResumeIntentHandled,
  autoStartVoice,
  onAutoStartVoiceHandled,
}: ShopWorkspaceProps) {
  const { enqueueIntent, connectionStatus, isProcessing } =
    shopM.useMaelstrom();
  const {
    state: voiceState,
    error: voiceError,
    connect: connectVoice,
  } = shopM.useVoice();
  const thinking = isProcessing || voiceState === 'thinking';
  const browserKeyMode = usesBrowserKey();
  const browserOpenAIVoice = usesBrowserOpenAIVoice();
  const apiKey = useStore(playgroundKeyStore, (state) => state.apiKey);
  const needsKey = browserKeyMode && !apiKey;

  useEffect(() => {
    if (!autoStartVoice) return;
    onAutoStartVoiceHandled();
    void connectVoice().catch(() => {});
  }, [autoStartVoice, connectVoice, onAutoStartVoiceHandled]);

  // A browser-key mint failure, or a Live exchange the key could not
  // authorize, means the visitor's key is missing or rejected, so the drawer
  // reopens with that layer's safe message.
  useEffect(() => {
    if (!browserOpenAIVoice || voiceState !== 'error') return;
    if (isLiveInvalidKeyError(voiceError)) {
      onMintError(liveErrorMessage(voiceError.cause));
      return;
    }
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

  const draftRevision = useRef(0);
  const latestSubmission = useRef<IntentSubmission | null>(null);
  const current = useRef({ intent, onIntentChange, onMintError });
  useLayoutEffect(() => {
    current.current = { intent, onIntentChange, onMintError };
  });
  const lifetime = useRef({ active: true });

  useEffect(() => {
    const owner = { active: true };
    lifetime.current = owner;
    return () => {
      owner.active = false;
    };
  }, [enqueueIntent]);

  const changeDraft = (value: string) => {
    draftRevision.current++;
    onIntentChange(value);
  };

  const submit = (): boolean => {
    const text = intent.trim();
    if (!text) return false;
    if (needsKey) {
      onBlockedSubmit();
      return false;
    }
    const ticket = enqueueIntent(text);
    const owner = lifetime.current;
    latestSubmission.current = ticket;
    if (ticket.accepted) changeDraft('');
    const revision = draftRevision.current;
    void ticket.result.then((result) => {
      if (!owner.active) return;
      if (
        browserKeyMode &&
        (result.status === 'failed' || result.status === 'unknown') &&
        isInvalidKeyError(result.error)
      ) {
        if (
          latestSubmission.current === ticket &&
          draftRevision.current === revision &&
          !current.current.intent
        )
          current.current.onIntentChange(intent);
        current.current.onMintError('Invalid API key.');
      }
    });
    return ticket.accepted;
  };

  // A refused resume stays pending and retries only when processing changes,
  // so a full queue is retried as it drains rather than in a tight loop.
  useEffect(() => {
    if (!resumeIntent || connectionStatus !== 'connected') return;
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      if (!intent.trim() || submit()) onResumeIntentHandled();
    });
    return () => {
      live = false;
    };
  }, [resumeIntent, connectionStatus, isProcessing]);

  return (
    <div className="demo-shell shop-shell relative z-[2]">
      <ShopHeader>
        <VoiceProviderSelect
          useVoice={shopM.useVoice}
          options={SHOP_VOICE_PROVIDERS}
        />
        {browserKeyMode && (
          <button
            type="button"
            onClick={onRequireKey}
            className="status-pill flex items-center gap-2 rounded-full px-3 py-1 font-mono text-xs uppercase tracking-[.1em] text-ink-2"
          >
            API key
          </button>
        )}
        <ConnectionStatus />
      </ShopHeader>

      <main className="demo-main relative">
        <div
          className="chart-wrapper"
          data-thinking={thinking ? 'true' : undefined}
        >
          <shopM.Chart />
        </div>
      </main>

      <footer className="shop-dock border-t bg-bg-1">
        <ShopIntentForm
          intent={intent}
          onIntentChange={changeDraft}
          onSubmit={submit}
          submitLabel="Send"
        />
        <ShopVoiceCorner needsKey={needsKey} onRequireKey={onBlockedSubmit} />
      </footer>
    </div>
  );
}

function ConnectionStatus() {
  const { connectionStatus } = shopM.useMaelstrom();
  const color = STATUS_COLORS[connectionStatus];

  return (
    <div
      className="status-pill flex items-center gap-2 rounded-full px-3 py-1 font-mono text-xs uppercase tracking-[.1em] text-ink-2"
      role="status"
      aria-label={
        connectionStatus === 'error'
          ? 'Shop connection failed. Reload to retry.'
          : `Connection status: ${connectionStatus}`
      }
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
      {connectionStatus === 'error' ? 'Error: reload' : connectionStatus}
    </div>
  );
}
