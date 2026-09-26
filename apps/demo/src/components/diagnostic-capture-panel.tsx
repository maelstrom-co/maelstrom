import { useState, useSyncExternalStore } from 'react';
import { diagnosticCapture } from '../lib/diagnostic-capture';
import { m } from '../lib/maelstrom';

export function DiagnosticCapturePanel() {
  const { owner, provider } = m.useVoice();
  const state = useSyncExternalStore(
    diagnosticCapture.subscribe,
    diagnosticCapture.getSnapshot,
    diagnosticCapture.getSnapshot,
  );
  const [outcome, setOutcome] = useState('');
  const [input, setInput] = useState('typed');
  const download = () => {
    const blob = new Blob([diagnosticCapture.export(outcome)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `maelstrom-diagnostic-${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section
      aria-labelledby="capture-title"
      className="my-5 space-y-3 rounded-lg border border-ink-3 p-3 text-sm"
    >
      <h3 id="capture-title" className="font-semibold">
        Local request capture
      </h3>
      <p>
        Start before one test request. This captures transcript text, tool
        intents, and Action parameters in this tab only. Nothing is uploaded
        automatically.
      </p>
      <p>
        For typed tests, end voice first. For voice tests, connect and wait for
        the introduction before starting capture.
      </p>
      <label className="block">
        Test input
        <select
          className="ml-2 rounded border border-ink-3 bg-bg-1 p-2"
          value={input}
          disabled={state.active}
          onChange={(event) => setInput(event.target.value)}
        >
          <option value="typed">Typed</option>
          <option value="voice">{provider} voice</option>
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn min-h-11"
          disabled={state.active}
          onClick={() => {
            setOutcome('');
            diagnosticCapture.start(
              input === 'typed' ? 'typed' : provider,
              owner.memory.sessionId,
              owner.providerInstanceId,
            );
            const snapshot = owner.session.observations.getSnapshot();
            diagnosticCapture.observations(
              snapshot,
              {
                provider,
                providerInstanceId: owner.providerInstanceId,
              },
              true,
            );
          }}
        >
          Start capture
        </button>
        <button
          type="button"
          className="btn min-h-11"
          disabled={!state.active}
          onClick={() => diagnosticCapture.stop()}
        >
          Stop capture
        </button>
        <button
          type="button"
          className="btn min-h-11"
          disabled={state.active || state.count === 0}
          onClick={download}
        >
          Download trace
        </button>
        <button
          type="button"
          className="btn min-h-11"
          onClick={() => {
            diagnosticCapture.clear();
            setOutcome('');
          }}
        >
          Clear capture
        </button>
      </div>
      <p role="status">
        {state.active ? 'Recording' : 'Stopped'} · {state.count} events ·{' '}
        {state.dropped} omitted
      </p>
      <label className="block">
        What happened?
        <textarea
          className="mt-1 w-full rounded border border-ink-3 bg-bg-1 p-2"
          value={outcome}
          maxLength={4000}
          onChange={(event) => setOutcome(event.target.value)}
          placeholder="Exact request, visible title, and any delay you noticed"
        />
      </label>
      <details>
        <summary>Inspect captured events</summary>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">
          {state.active
            ? 'Stop capture to inspect the trace.'
            : diagnosticCapture.export(outcome)}
        </pre>
      </details>
      <p className="text-xs text-ink-3">
        Server retries and internal delegation text are unavailable. Captured
        dates are diagnostic metadata, not new model context.
      </p>
    </section>
  );
}
