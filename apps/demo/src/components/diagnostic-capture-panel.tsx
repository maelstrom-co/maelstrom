import { Circle, Download, Square, Trash2 } from 'lucide-react';
import { useMemo, useSyncExternalStore } from 'react';
import { useDemoMaelstrom } from '../lib/demo-maelstrom-context';
import { demoVoiceSession } from '../lib/demo-voice';
import { diagnosticCapture } from '../lib/diagnostic-capture';
import { DiagnosticEvents } from './diagnostic-events';

export function DiagnosticCapturePanel() {
  const m = useDemoMaelstrom();
  const { session, provider } = m.useVoice();
  const { snapshot } = m.useVoiceObservations();
  const providerInstanceId =
    demoVoiceSession(session)?.providerInstanceId ?? 'unobserved';
  const mode = snapshot.connection === 'connected' ? provider : 'typed';
  return (
    <CapturePanel
      source={{
        mode,
        transitioning:
          snapshot.connection === 'connecting' ||
          snapshot.connection === 'disconnecting',
        start: () => {
          diagnosticCapture.start(
            mode,
            session.memory.sessionId,
            providerInstanceId,
          );
          diagnosticCapture.observations(
            session.observations.getSnapshot(),
            { provider, providerInstanceId },
            true,
          );
        },
      }}
    />
  );
}

export function CapturePanel({
  source,
}: {
  source?: { mode: string; transitioning: boolean; start: () => void };
}) {
  const state = useSyncExternalStore(
    diagnosticCapture.subscribe,
    diagnosticCapture.getSnapshot,
    diagnosticCapture.getSnapshot,
  );
  const mode = source?.mode ?? 'typed';
  const transitioning = source?.transitioning ?? false;
  const trace = useMemo(
    () =>
      state.active
        ? undefined
        : (JSON.parse(diagnosticCapture.export('')) as {
            metadata: { mode?: string };
            events: object[];
          }),
    [state.active, state.count, state.dropped],
  );
  const hasCapture = state.count > 0;
  const inputLabel = (value: string) =>
    value === 'typed'
      ? 'Typed input'
      : `${value === 'live' ? 'GPT-Live' : value === 'realtime' ? 'Realtime' : 'LiveKit'} voice`;
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([diagnosticCapture.export()], {
        type: 'application/json',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `maelstrom-diagnostic-${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section aria-labelledby="capture-title" className="debug-section">
      <div className="debug-section-heading">
        <h3 id="capture-title">Request capture</h3>
        <span
          className={`debug-badge ${state.active ? 'debug-badge-recording' : ''}`}
          role="status"
        >
          {state.active
            ? 'Recording'
            : hasCapture
              ? 'Ready to export'
              : 'Not recording'}
        </span>
      </div>
      <p className="debug-help">
        Record one request to inspect transcripts, tool intents, and Action
        parameters. Stored in this tab only; uploaded only if you share the
        downloaded file.
      </p>
      <div className="debug-capture-card">
        <div className="debug-section-heading">
          <span className="debug-eyebrow">
            {hasCapture ? 'Captured input' : 'Detected input'}
          </span>
          <strong>
            {inputLabel(hasCapture ? (state.mode ?? mode) : mode)}
          </strong>
        </div>
        <p className="debug-help">
          {state.active
            ? 'Make your request, then stop after the response finishes.'
            : hasCapture
              ? 'Review the events and add a note before downloading.'
              : !source
                ? 'Add an API key to start a new capture.'
                : transitioning
                  ? 'Wait for the voice connection to finish changing.'
                  : mode === 'typed'
                    ? 'Start capture, then type your request. Connect voice first to capture a voice test.'
                    : 'Wait for the introduction, then start capture before speaking. End voice first for a typed test.'}
        </p>
        <div className="debug-actions">
          {state.active ? (
            <button
              className="debug-button debug-button-record"
              type="button"
              onClick={() => diagnosticCapture.stop()}
            >
              <Square size={14} aria-hidden="true" />
              Stop capture
            </button>
          ) : (
            <button
              className="debug-button debug-button-primary"
              type="button"
              disabled={hasCapture || transitioning || !source}
              onClick={() => source?.start()}
            >
              <Circle size={14} aria-hidden="true" />
              Start capture
            </button>
          )}
          <button
            className="debug-button"
            type="button"
            disabled={state.active || !hasCapture}
            onClick={download}
          >
            <Download size={15} aria-hidden="true" />
            Download trace
          </button>
          <button
            className="debug-button debug-button-subtle"
            type="button"
            disabled={state.active || !hasCapture}
            onClick={() => {
              diagnosticCapture.clear();
            }}
          >
            <Trash2 size={15} aria-hidden="true" />
            Clear capture
          </button>
        </div>
        <p className="debug-help">
          {state.count} events captured
          {state.dropped > 0 && (
            <span className="debug-warning">
              {' '}
              · {state.dropped} omitted — capture limit reached
            </span>
          )}
          {hasCapture && !state.active
            ? ' · Clear to start a new recording.'
            : ''}
        </p>
      </div>
      {hasCapture && (
        <label className="debug-label">
          What happened? <span className="debug-help">Optional</span>
          <textarea
            value={state.outcome}
            maxLength={4000}
            onChange={(event) =>
              diagnosticCapture.setOutcome(event.target.value)
            }
            placeholder="What you asked, what changed, and anything unexpected…"
            rows={3}
          />
        </label>
      )}
      {hasCapture && !state.active && trace && (
        <DiagnosticEvents events={trace.events} label="Captured events" />
      )}
      {!hasCapture && (
        <div className="debug-empty">
          <Circle size={22} aria-hidden="true" />
          <strong>Ready when you are</strong>
          <span>
            Start a capture to follow a request from intent to UI update.
          </span>
        </div>
      )}
      <details className="debug-disclosure">
        <summary>What this trace can tell you</summary>
        <p className="debug-help">
          Timings use this browser’s clock. Playback acceptance does not prove
          audible speech. Server retries, provider-confirmed Engine model, and
          internal delegation text are not exposed. Captured dates are
          diagnostic metadata, not new model context.
        </p>
      </details>
    </section>
  );
}
