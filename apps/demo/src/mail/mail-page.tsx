import type { IntentSubmission } from '@maelstrom-co/client';
import { SessionId } from '@maelstrom-co/protocol';
import { RealtimeVoiceError } from '@maelstrom-co/realtime';
import { useStore } from '@tanstack/react-store';
import { Bell, BellOff, Mail, Search } from 'lucide-react';
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { KeyDrawer } from '../components/key-drawer';
import { createDemoConnector } from '../lib/connector';
import { isDebugRequested } from '../lib/debug-mode';
import { diagnosticCapture } from '../lib/diagnostic-capture';
import {
  isHosted,
  usesBrowserKey,
  usesBrowserOpenAIVoice,
} from '../lib/hosted-mode';
import { preloadHostedVadAssets } from '../lib/hosted-vad';
import {
  clearPlaygroundKey,
  playgroundKeyStore,
  setPlaygroundKey,
} from '../lib/playground-key-store';
import { prepareBrowserOpenAIVoice } from '../lib/voice-adapter';
import { voiceProviderStore } from '../lib/voice-provider';
import { MAIL_DEFAULT_LAYOUT, MAIL_NARROW_LAYOUT } from './default-layout';
import { mailM } from './maelstrom';
import { MailActionFlash, useMailWorking } from './mail-activity';
import { MailOptionSync } from './mail-option-sync';
import { MailReplyLine } from './mail-reply-line';
import { MailVoiceCorner } from './mail-voice-corner';
import { useSettingsStore } from './stores/settings.store';
import './mail.css';

export const MAIL_INTENT_PLACEHOLDER =
  "Type or tap the mic, like 'bigger text'";

export function MailPage() {
  const hosted = isHosted();
  const browserKeyMode = usesBrowserKey();
  const apiKey = useStore(playgroundKeyStore, (state) => state.apiKey);
  const { theme } = useSettingsStore();
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
  const initialLayout = useMemo(
    () =>
      layoutHostWidth !== null && layoutHostWidth <= 640
        ? MAIL_NARROW_LAYOUT
        : MAIL_DEFAULT_LAYOUT,
    [layoutHostWidth],
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
    <div ref={layoutHostRef} className="mail-app" data-theme={theme}>
      {connector && layoutHostWidth !== null ? (
        <mailM.Provider
          key={keyEpoch}
          sessionId={sessionId}
          connector={connector}
          initialLayout={initialLayout}
          debug={debug}
        >
          <MailOptionSync />
          <MailWorkspace
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
        </mailM.Provider>
      ) : connector ? null : (
        <MailKeylessShell
          intent={intent}
          onIntentChange={setIntent}
          onRequireKey={requireKey}
          onBlockedSubmit={handleBlockedSubmit}
        />
      )}
      {debug && <mailM.Devtools />}
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
                (voiceProviderStore.state.provider === 'live' ||
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

interface MailWorkspaceProps {
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

function MailWorkspace({
  onRequireKey,
  onBlockedSubmit,
  onMintError,
  intent,
  onIntentChange,
  resumeIntent,
  onResumeIntentHandled,
  autoStartVoice,
  onAutoStartVoiceHandled,
}: MailWorkspaceProps) {
  const { enqueueIntent, connectionStatus } = mailM.useMaelstrom();
  const {
    state: voiceState,
    error: voiceError,
    connect: connectVoice,
  } = mailM.useVoice();
  const browserKeyMode = usesBrowserKey();
  const browserOpenAIVoice = usesBrowserOpenAIVoice();
  const apiKey = useStore(playgroundKeyStore, (state) => state.apiKey);
  const needsKey = browserKeyMode && !apiKey;
  const working = useMailWorking();
  const [replySubmission, setReplySubmission] =
    useState<IntentSubmission | null>(null);

  useEffect(() => {
    if (!autoStartVoice) return;
    onAutoStartVoiceHandled();
    void connectVoice().catch(() => {});
  }, [autoStartVoice, connectVoice, onAutoStartVoiceHandled]);

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

  const submit = () => {
    const text = intent.trim();
    if (!text) return;
    if (needsKey) {
      onBlockedSubmit();
      return;
    }
    const submission = enqueueIntent(text);
    setReplySubmission(submission);
    if (submission.accepted) onIntentChange('');
  };

  useEffect(() => {
    if (!resumeIntent || connectionStatus !== 'connected') return;
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      onResumeIntentHandled();
      submit();
    });
    return () => {
      live = false;
    };
  }, [resumeIntent, connectionStatus]);

  return (
    <div className="mail-shell">
      <MailHeader
        intent={intent}
        onIntentChange={onIntentChange}
        onSubmit={submit}
        onRequireKey={browserKeyMode ? onRequireKey : undefined}
        replySubmission={replySubmission}
      />
      <main className="mail-main">
        <div className="mail-chart-host" data-working={working || undefined}>
          <mailM.Chart />
        </div>
        <MailActionFlash />
      </main>
      <footer className="mail-footer">
        <MailVoiceCorner needsKey={needsKey} onRequireKey={onBlockedSubmit} />
      </footer>
    </div>
  );
}

interface MailKeylessShellProps {
  readonly intent: string;
  readonly onIntentChange: (intent: string) => void;
  readonly onRequireKey: () => void;
  readonly onBlockedSubmit: () => void;
}

function MailKeylessShell({
  intent,
  onIntentChange,
  onRequireKey,
  onBlockedSubmit,
}: MailKeylessShellProps) {
  return (
    <div className="mail-shell">
      <MailHeader
        intent={intent}
        onIntentChange={onIntentChange}
        onSubmit={onBlockedSubmit}
        onRequireKey={onRequireKey}
      />
      <main className="mail-main">
        <p className="mail-keyless-note">
          Add an OpenAI API key to open your mail.
        </p>
      </main>
      <footer className="mail-footer" />
    </div>
  );
}

interface MailHeaderProps {
  readonly intent: string;
  readonly onIntentChange: (intent: string) => void;
  readonly onSubmit: () => void;
  readonly onRequireKey?: () => void;
  readonly replySubmission?: IntentSubmission | null;
}

function MailHeader({
  intent,
  onIntentChange,
  onSubmit,
  onRequireKey,
  replySubmission = null,
}: MailHeaderProps) {
  const { notificationsOn } = useSettingsStore();
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <header className="mail-header">
      <div className="mail-brand">
        <span className="mail-brand-mark" aria-hidden="true">
          <Mail size={18} strokeWidth={2} />
        </span>
        Mail
      </div>
      <div className="mail-search-column">
        <form className="mail-search" onSubmit={handleSubmit}>
          <Search size={18} aria-hidden="true" />
          <input
            type="text"
            name="intent"
            aria-label="Ask Mail"
            value={intent}
            onChange={(event) => onIntentChange(event.target.value)}
            placeholder={MAIL_INTENT_PLACEHOLDER}
          />
          <button
            type="submit"
            className="mail-search-submit"
            disabled={!intent.trim()}
          >
            Go
          </button>
        </form>
        <MailReplyLine submission={replySubmission} />
      </div>
      <div className="mail-header-actions">
        {onRequireKey ? (
          <button
            type="button"
            className="mail-key-button"
            onClick={onRequireKey}
          >
            API key
          </button>
        ) : null}
        <HeaderIcon
          label={
            notificationsOn
              ? 'Email notifications on'
              : 'Email notifications off'
          }
          muted={!notificationsOn}
        >
          {notificationsOn ? <Bell size={20} /> : <BellOff size={20} />}
        </HeaderIcon>
        <span className="mail-avatar" aria-hidden="true">
          A
        </span>
      </div>
    </header>
  );
}

function HeaderIcon({
  label,
  muted,
  children,
}: {
  readonly label: string;
  readonly muted: boolean;
  readonly children: ReactNode;
}) {
  return (
    <span
      className="mail-icon-button mail-bell"
      role="img"
      aria-label={label}
      data-muted={muted}
    >
      {children}
    </span>
  );
}
