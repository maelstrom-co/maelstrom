import { SessionId } from '@maelstrom-co/protocol';
import {
  defaultShouldRestoreDraft,
  type IntentSubmitFailure,
} from '@maelstrom-co/react';
import { RealtimeVoiceError } from '@maelstrom-co/realtime';
import { useStore } from '@tanstack/react-store';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  isLiveInvalidKeyError,
  isProviderFailure,
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
import { ShopAgentReply } from './shop-agent-reply';
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
  // oxlint-disable-next-line react/exhaustive-deps -- Session epochs and queued-resume transitions are the intentional triggers.
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
  const { connectionStatus } = shopM.useMaelstrom();
  const {
    state: voiceState,
    error: voiceError,
    connect: connectVoice,
  } = shopM.useVoice();
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

  const {
    setDraft: changeDraft,
    submit,
    busy: thinking,
  } = shopM.useIntentSubmit({
    draft: intent,
    onDraftChange: onIntentChange,
    voiceState,
    beforeSubmit: () => {
      if (!needsKey) return true;
      onBlockedSubmit();
      return false;
    },
    shouldRestoreDraft: (failure) =>
      defaultShouldRestoreDraft(failure) ||
      isShopProviderFailure(browserKeyMode, failure),
    onFailure: (failure) => {
      if (isShopProviderFailure(browserKeyMode, failure)) {
        onMintError(MODEL_FAILURE_MESSAGE);
      }
    },
  });

  // The resume waits for a connected session. A refusal while a key is still
  // needed stays pending until the next connection change.
  useEffect(() => {
    if (!resumeIntent || connectionStatus !== 'connected') return;
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      if (!intent.trim() || submit()?.accepted) onResumeIntentHandled();
    });
    return () => {
      live = false;
    };
    // oxlint-disable-next-line react/exhaustive-deps -- A new resume request and connection changes are the intentional triggers.
  }, [resumeIntent, connectionStatus]);

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
        <ShopVoiceCorner
          needsKey={needsKey}
          onRequireKey={onBlockedSubmit}
          reply={<ShopAgentReply />}
        />
        <ShopIntentForm
          intent={intent}
          onIntentChange={changeDraft}
          onSubmit={submit}
          submitLabel="Send"
        />
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

const MODEL_FAILURE_MESSAGE =
  'The model request failed. Check your API key and try again.';

function isShopProviderFailure(
  browserKeyMode: boolean,
  failure: IntentSubmitFailure,
): boolean {
  return (
    browserKeyMode &&
    failure.route === 'agent' &&
    failure.result.status === 'failed' &&
    isProviderFailure(failure.result.error)
  );
}
