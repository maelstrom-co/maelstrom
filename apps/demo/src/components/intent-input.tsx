import {
  type IntentSnapshot,
  type IntentSubmission,
  WireEngineError,
} from '@maelstrom-co/client';
import { useStore } from '@tanstack/react-store';
import { useEffect, useRef, useState } from 'react';
import { usesBrowserKey } from '../lib/hosted-mode';
import { m } from '../lib/maelstrom';
import { playgroundKeyStore } from '../lib/playground-key-store';
import { AssistantResponse } from './assistant-response';
import { Captions } from './captions';
import { FIRST_RUN_EXAMPLES } from './first-run-hint';
import { VoiceControl } from './voice-control';
import { VoiceErrorNote } from './voice-error-note';

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

interface IntentInputProps {
  readonly onBlockedSubmit: () => void;
  readonly onMintError: (message: string) => void;
  readonly intent: string;
  readonly onIntentChange: (intent: string) => void;
  readonly resumeIntent: boolean;
  readonly onResumeIntentHandled: () => void;
}

export function IntentInput({
  onBlockedSubmit,
  onMintError,
  intent,
  onIntentChange,
  resumeIntent,
  onResumeIntentHandled,
}: IntentInputProps) {
  const { enqueueIntent, connectionStatus } = m.useMaelstrom();
  const { state: voiceState } = m.useVoice();
  const voiceActive = voiceState !== 'idle' && voiceState !== 'error';
  const browserKeyMode = usesBrowserKey();
  const apiKey = useStore(playgroundKeyStore, (state) => state.apiKey);
  const needsKey = browserKeyMode && !apiKey;
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const draftRevision = useRef(0);
  const latestSubmission = useRef<IntentSubmission | null>(null);
  const current = useRef({ intent, onIntentChange, onMintError });
  current.current = { intent, onIntentChange, onMintError };
  const lifetime = useRef({
    active: true,
    subscriptions: new Set<() => void>(),
  });

  useEffect(() => {
    const owner = { active: true, subscriptions: new Set<() => void>() };
    lifetime.current = owner;
    setEntries([]);
    return () => {
      owner.active = false;
      for (const unsubscribe of owner.subscriptions) unsubscribe();
      owner.subscriptions.clear();
    };
  }, [enqueueIntent]);

  const changeDraft = (value: string) => {
    draftRevision.current++;
    onIntentChange(value);
  };

  const submit = () => {
    if (!intent.trim()) return;
    if (needsKey) {
      onBlockedSubmit();
      return;
    }
    const text = intent;
    const ticket = enqueueIntent(text);
    const owner = lifetime.current;
    latestSubmission.current = ticket;
    if (ticket.accepted) changeDraft('');
    const revision = draftRevision.current;
    const update = () => {
      if (!owner.active) return;
      setEntries((previous) =>
        trimFeedback([
          ...previous.filter((entry) => entry.ticket !== ticket),
          { ticket, text, snapshot: ticket.store.state },
        ]),
      );
    };
    const subscription = ticket.store.subscribe(update);
    const unsubscribe = () => subscription.unsubscribe();
    owner.subscriptions.add(unsubscribe);
    update();
    void ticket.result.then((result) => {
      unsubscribe();
      owner.subscriptions.delete(unsubscribe);
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
          current.current.onIntentChange(text);
        current.current.onMintError('Invalid API key.');
      }
    });
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit();
  };

  const feedback = entries
    .filter(({ snapshot }) => !voiceActive || snapshot.status !== 'applied')
    .map(
      ({ ticket, text, snapshot }) =>
        `${ticket.id} “${text}”: ${describeIntent(snapshot)}`,
    )
    .join(' · ');

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
      <AssistantResponse
        isProcessing={false}
        message={feedback || undefined}
        voiceActive={false}
      />
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
            onChange={(e) => changeDraft(e.target.value)}
            placeholder="Tell Maelstrom what you want to arrange..."
            className="intent-pill min-w-0 flex-1 px-4 py-2.5"
          />
          <button
            type="submit"
            disabled={!intent.trim()}
            className="btn btn-primary min-h-11 shrink-0 px-4 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>

        <datalist id="demo-intent-examples">
          {FIRST_RUN_EXAMPLES.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      </form>
    </div>
  );
}

interface FeedbackEntry {
  readonly ticket: IntentSubmission;
  readonly text: string;
  readonly snapshot: IntentSnapshot;
}

function trimFeedback(entries: FeedbackEntry[]): FeedbackEntry[] {
  const pending = entries.filter(
    ({ snapshot }) =>
      snapshot.status === 'queued' || snapshot.status === 'processing',
  );
  const terminal = entries.filter(
    ({ snapshot }) =>
      snapshot.status !== 'queued' && snapshot.status !== 'processing',
  );
  return [...terminal.slice(-6), ...pending];
}

function describeIntent(snapshot: IntentSnapshot): string {
  switch (snapshot.status) {
    case 'queued':
      return `Queued (#${snapshot.queuePosition})`;
    case 'processing':
      return 'Processing';
    case 'applied':
      return `Applied${snapshot.response.userMessage ? ` — ${snapshot.response.userMessage}` : ''}`;
    case 'failed':
      return `Not applied — ${snapshot.error.message}`;
    case 'unknown':
      return `Outcome unknown — ${snapshot.error.message}. Check the workspace before retrying.`;
    case 'not_submitted': {
      const reasons = {
        queue_full: 'Queue full — draft kept',
        queue_expired: 'Queue expired — not submitted',
        disconnected: 'Disconnected — not submitted',
        disposed: 'Workspace closed — not submitted',
        connector_replaced: 'Connection replaced — not submitted',
        owner_retired: 'Owner retired — not submitted',
      };
      return reasons[snapshot.reason];
    }
  }
}
