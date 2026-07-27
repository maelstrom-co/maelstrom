import { WireEngineError } from '@maelstrom-co/client';
import { SessionId } from '@maelstrom-co/protocol';
import { RealtimeVoiceError } from '@maelstrom-co/realtime';
import { createFileRoute } from '@tanstack/react-router';
import { useStore } from '@tanstack/react-store';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Captions } from '../components/captions';
import { FIRST_RUN_EXAMPLES, FirstRunHint } from '../components/first-run-hint';
import { KeyDrawer } from '../components/key-drawer';
import { VoiceControl } from '../components/voice-control';
import { VoiceErrorNote } from '../components/voice-error-note';
import { createDemoConnector } from '../lib/connector';
import { isDebugRequested } from '../lib/debug-mode';
import { STATUS_COLORS } from '../lib/design-tokens';
import { isHosted } from '../lib/hosted-mode';
import { m } from '../lib/maelstrom';
import {
  clearPlaygroundKey,
  playgroundKeyStore,
  setPlaygroundKey,
} from '../lib/playground-key-store';
import { useFlashInstances } from '../lib/use-touched-instances';

/**
 * True for a text-path (chart_request) failure caused by a rejected OpenAI
 * key — the hosted-mode analogue of the voice path's TOKEN_MINT_FAILED. The
 * wire error's `code` is the engine's `ProviderError._tag`, which covers
 * every LLM-adapter failure (network, rate limit, bad key); the message
 * text is what actually narrows it to a rejected key.
 */
function isInvalidKeyError(error: Error): boolean {
  const code = error instanceof WireEngineError ? error.code : undefined;
  if (code !== 'ProviderError') return false;
  return /\b401\b|invalid api key|incorrect api key/i.test(error.message);
}

export const Route = createFileRoute('/')({
  component: HomePage,
});

// Exported in addition to `Route` so a component test can mount it
// directly — `Route.options.component` only resolves inside an actual
// router match (TanStack Start's root layout renders a full html/head/body
// document via <Outlet>, which isn't practical to drive in a component
// test). This is the only route in the app, so opting it out of TanStack
// Router's per-route code-splitting costs nothing here.
export function HomePage() {
  const hosted = isHosted();
  // Bumping this forces a fresh <m.Provider key={keyEpoch}>, which remounts
  // the connector/session cleanly. useMaelstrom() exposes no public
  // disconnect(), so remount-by-key is the supported way to force a clean
  // session boundary from outside the provider tree — needed both when the
  // key drawer saves a key (the Provider already connected once on mount
  // without one, so that handshake skipped the playground.hello frame) and
  // when it's cleared.
  const [keyEpoch, setKeyEpoch] = useState(0);
  // Starts closed even when hosted and keyless — the playground renders
  // keyless by design. It only opens via onRequireKey, when a Send/mic press
  // actually needs a key that isn't there yet.
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Lifted above <m.Provider key={keyEpoch}> so a key-save remount doesn't
  // wipe whatever the visitor already typed while the drawer was blocking
  // them — resumeIntent then carries it through to an auto-submit once the
  // fresh connection is up.
  const [intent, setIntent] = useState('');
  const [resumeIntent, setResumeIntent] = useState(false);
  // True only while the drawer is up because a Send/mic press was actually
  // blocked on a missing key — as opposed to the header "API key" button or
  // a mint-error reopen, neither of which should auto-submit whatever text
  // happens to be sitting in the box on save.
  const [blockedSubmit, setBlockedSubmit] = useState(false);

  // Populated when a voice mint fails in hosted mode, so the reopened
  // drawer explains why rather than looking like an unprompted reappearance.
  const [keyErrorMessage, setKeyErrorMessage] = useState<string | null>(null);
  // Stable across renders — passed as an effect dependency in DemoApp, and an
  // unstable reference there would re-fire that effect on every render while
  // voice state sits in 'error'.
  const handleMintError = useCallback((message: string) => {
    setKeyErrorMessage(message);
    setDrawerOpen(true);
  }, []);

  // One id per session boundary, shared by the Provider — which keys the
  // container-side engine and its conversation history — and the connector,
  // which uses it to pin the shard. Minting them separately would let shard
  // routing and session identity drift apart, so a reconnect could reach a
  // container that has never seen the session.
  // keyEpoch is the dependency even though the factory never reads it: the
  // point is to mint a NEW id whenever the epoch bumps, which is exactly the
  // session boundary the Provider remount defines. It is not a stale dep.
  const sessionId = useMemo(() => SessionId(), [keyEpoch]);
  const connector = useMemo(
    () =>
      createDemoConnector({
        sessionId,
        getApiKey: () => playgroundKeyStore.state.apiKey,
      }),
    [sessionId],
  );
  const debug = useMemo(() => isDebugRequested(), []);

  return (
    <>
      <m.Provider
        key={keyEpoch}
        sessionId={sessionId}
        connector={connector}
        debug={debug}
      >
        <DemoApp
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
        />
      </m.Provider>
      {hosted && (
        <KeyDrawer
          isOpen={drawerOpen}
          onClose={() => {
            setDrawerOpen(false);
            setKeyErrorMessage(null);
            setBlockedSubmit(false);
          }}
          onSave={(key, remember) => {
            // Re-entering (or merely viewing) the same key from the header
            // pill must not remount <m.Provider> mid-session — that would
            // mint a fresh sessionId and drop everything the LLM has
            // arranged so far. Only a genuine key change earns the reset.
            const keyChanged = key !== playgroundKeyStore.state.apiKey;
            setPlaygroundKey(key, remember);
            setDrawerOpen(false);
            setKeyErrorMessage(null);
            if (!keyChanged) {
              setBlockedSubmit(false);
              return;
            }
            setResumeIntent(blockedSubmit && intent.trim().length > 0);
            setBlockedSubmit(false);
            setKeyEpoch((e) => e + 1);
          }}
          onRemove={() => {
            clearPlaygroundKey();
            setDrawerOpen(false);
            setKeyErrorMessage(null);
            setBlockedSubmit(false);
            setKeyEpoch((e) => e + 1);
          }}
          errorMessage={keyErrorMessage}
        />
      )}
    </>
  );
}

interface DemoAppProps {
  readonly onRequireKey: () => void;
  readonly onBlockedSubmit: () => void;
  readonly onMintError: (message: string) => void;
  readonly intent: string;
  readonly onIntentChange: (intent: string) => void;
  readonly resumeIntent: boolean;
  readonly onResumeIntentHandled: () => void;
}

function DemoApp({
  onRequireKey,
  onBlockedSubmit,
  onMintError,
  intent,
  onIntentChange,
  resumeIntent,
  onResumeIntentHandled,
}: DemoAppProps) {
  const { isProcessing } = m.useMaelstrom();
  const { state: voiceState, error: voiceError } = m.useVoice();
  const thinking = isProcessing || voiceState === 'thinking';
  const hosted = isHosted();

  // In hosted/BYOK mode a mint failure means the visitor's key is missing or
  // rejected, not a server misconfiguration — reopen the drawer with the
  // mint layer's own safe error text (never the key, never raw upstream
  // text) instead of leaving VoiceErrorNote's server-env copy as the only
  // signal, since that copy doesn't apply once there's no server-side key.
  useEffect(() => {
    if (!hosted || voiceState !== 'error') return;
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
  }, [hosted, voiceState, voiceError, onMintError]);

  return (
    <div className="h-screen flex flex-col relative z-[2]">
      {/* Header */}
      <header
        className="border-b px-6 py-4 bg-bg-1"
        style={{ borderColor: 'var(--line)' }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h1 className="eyebrow">Maelstrom Demo</h1>
            <p className="text-sm text-ink-2 mt-1">
              AI-Orchestrated Dynamic UI
            </p>
          </div>
          <div className="flex items-center gap-3">
            <VoiceControl showOrb={false} />
            {hosted && (
              <button
                type="button"
                onClick={onRequireKey}
                className="status-pill flex items-center gap-2 rounded-full px-3 py-1 font-mono text-xs uppercase tracking-[.1em] text-ink-2"
              >
                API key
              </button>
            )}
            <StatusIndicator />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 relative">
        <div
          className="chart-wrapper"
          data-thinking={thinking ? 'true' : undefined}
        >
          <m.Chart />
        </div>
        <FirstRunHint />
        <ActionFlash />
        <Captions />
      </main>

      {/* Intent input */}
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

  return (
    <div
      className="status-pill flex items-center gap-2 rounded-full px-3 py-1 font-mono text-xs uppercase tracking-[.1em] text-ink-2"
      role="status"
      aria-label={`Connection status: ${connectionStatus}`}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
      {connectionStatus}
    </div>
  );
}

interface IntentInputProps {
  readonly onBlockedSubmit: () => void;
  readonly onMintError: (message: string) => void;
  readonly intent: string;
  readonly onIntentChange: (intent: string) => void;
  readonly resumeIntent: boolean;
  readonly onResumeIntentHandled: () => void;
}

function IntentInput({
  onBlockedSubmit,
  onMintError,
  intent,
  onIntentChange,
  resumeIntent,
  onResumeIntentHandled,
}: IntentInputProps) {
  const { processIntent, isProcessing, lastError, connectionStatus } =
    m.useMaelstrom();
  const hosted = isHosted();
  const apiKey = useStore(playgroundKeyStore, (state) => state.apiKey);
  const needsKey = hosted && !apiKey;
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
    if (!hosted || !lastError || !isInvalidKeyError(lastError)) return;
    // handleSubmit already cleared the input unconditionally (processIntent
    // never rejects) — restore what was actually submitted before reopening
    // the drawer, so the visitor doesn't lose their draft to a rejected key.
    onIntentChange(submittedIntentRef.current);
    onMintError('Invalid API key.');
  }, [hosted, lastError, onMintError, onIntentChange]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intent.trim() || isProcessing) return;
    submittedIntentRef.current = intent;
    if (needsKey) {
      onBlockedSubmit();
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
      className="border-t p-4 bg-bg-1"
      style={{ borderColor: 'var(--line)' }}
    >
      <VoiceErrorNote />
      <div
        className="flex justify-center mb-3"
        onClickCapture={handleOrbClickCapture}
      >
        <m.VoiceOrb size={56} className="voice-orb" />
      </div>
      <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
        <div className="flex gap-2">
          <input
            type="text"
            value={intent}
            onChange={(e) => onIntentChange(e.target.value)}
            placeholder="Tell Maelstrom what you want to do..."
            className="intent-pill flex-1 px-4 py-3"
            disabled={isProcessing}
          />
          <button
            type="submit"
            disabled={isProcessing || !intent.trim()}
            className="btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? 'Processing...' : 'Send'}
          </button>
        </div>

        {lastError && (
          <div className="mt-2 text-sm text-pink">
            Error: {lastError.message}
          </div>
        )}

        {/* Suggestions */}
        <div className="mt-3 flex flex-wrap gap-2">
          {FIRST_RUN_EXAMPLES.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onIntentChange(suggestion)}
              className="btn btn-ghost text-xs px-3 py-1.5"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}
