import { OpenAILiveAdapter } from '@maelstrom-co/realtime-openai-live';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { m } from '../lib/maelstrom';
import { DEFAULT_REALTIME_MODEL } from '../lib/realtime-model';
import { projectLiveTransport } from '../lib/voice-diagnostics';
import { LIVE_BACKEND_MODEL, LIVE_MODEL } from '../lib/voice-provider';

export function VoiceDebugDrawer() {
  const { owner, provider } = m.useVoice();
  const { snapshot } = m.useVoiceObservations();
  const timeline = useSyncExternalStore(
    owner.diagnostics.subscribe,
    owner.diagnostics.getSnapshot,
    owner.diagnostics.getSnapshot,
  );
  const history = useSyncExternalStore(
    owner.diagnostics.subscribe,
    owner.diagnostics.getTransportHistory,
    owner.diagnostics.getTransportHistory,
  );
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [, refreshTransport] = useState(0);
  const transport =
    owner.adapter instanceof OpenAILiveAdapter
      ? projectLiveTransport(owner.adapter.getTransportSnapshot())
      : undefined;
  useEffect(() => {
    const timer = setInterval(
      () => refreshTransport((value) => value + 1),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="status-pill min-h-11 rounded-full px-3 text-xs text-ink-2"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        Debug
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="voice-debug-title"
        onCancel={close}
        onClose={close}
        className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-md overflow-y-auto border-l border-ink-3 bg-bg-1 p-5 text-ink backdrop:bg-black/40"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="voice-debug-title" className="text-lg font-semibold">
            Voice diagnostics
          </h2>
          <button type="button" className="btn min-h-11" onClick={close}>
            Close
          </button>
        </div>
        <p className="my-3 text-xs text-ink-3">
          Metadata only. Timings use this browser's clock. Playback acceptance
          is not proof of audible speech.
        </p>
        <dl className="space-y-2 text-sm">
          <dt>Application session</dt>
          <dd className="break-all">{owner.memory.sessionId}</dd>
          <dt>Engine model</dt>
          <dd>Unavailable (server-owned configuration)</dd>
          <dt>Voice model</dt>
          <dd>
            {provider === 'live'
              ? LIVE_MODEL
              : provider === 'realtime'
                ? DEFAULT_REALTIME_MODEL
                : 'LiveKit cascade'}
          </dd>
          <dt>Managed backend model</dt>
          <dd>{provider === 'live' ? LIVE_BACKEND_MODEL : 'Not applicable'}</dd>
          <dt>Provider session</dt>
          <dd className="break-all">{transport?.sessionId ?? 'Unavailable'}</dd>
          <dt>Provider instance</dt>
          <dd className="break-all">{owner.providerInstanceId}</dd>
          <dt>Generation / connection</dt>
          <dd>
            {snapshot.generation} / {snapshot.connection}
          </dd>
          <dt>Microphone / incoming audio</dt>
          <dd>
            {snapshot.media.microphone} / {snapshot.media.incomingAudio}
          </dd>
          <dt>Engine planning / application</dt>
          <dd>
            {snapshot.applicationWork.planning} /{' '}
            {snapshot.applicationWork.applying}
          </dd>
          <dt>Voice usage</dt>
          <dd>
            {transport?.usageSeconds === undefined
              ? 'Unavailable'
              : `${transport.usageSeconds} seconds (cumulative)`}
          </dd>
          <dt>Final voice usage</dt>
          <dd>
            {transport?.finalUsageSeconds === undefined
              ? 'Unavailable'
              : `${transport.finalUsageSeconds} seconds`}
          </dd>
          <dt>Finalization / playback</dt>
          <dd>
            {transport?.finalization ?? 'Unavailable'} /{' '}
            {transport?.playback ?? 'Unavailable'}
          </dd>
          <dt>Backend usage / Engine usage</dt>
          <dd>Unavailable / Unavailable</dd>
          <dt>Native delegation correlation</dt>
          <dd>Unavailable through the current adapter</dd>
          <dt>Cancellation / durable history</dt>
          <dd>Unavailable</dd>
        </dl>
        <h3 className="mt-6 font-semibold">
          Ended Live connections ({history.length}/16)
        </h3>
        <ol
          aria-label="Ended Live connections"
          className="mt-3 space-y-3 break-all text-xs"
        >
          {history.map((entry) => (
            <li key={`${entry.providerInstanceId}:${entry.generation}`}>
              <div>
                {entry.model} · backend {entry.backendModel}
              </div>
              <div>
                Instance {entry.providerInstanceId} · generation{' '}
                {entry.generation}
              </div>
              <div>
                Session {entry.sessionId ?? 'Unavailable'} ·{' '}
                {entry.finalization}
              </div>
              <div>
                Cumulative:{' '}
                {entry.usageSeconds === undefined
                  ? 'Unavailable'
                  : `${entry.usageSeconds} seconds`}{' '}
                · Final:{' '}
                {entry.finalUsageSeconds === undefined
                  ? 'Unavailable'
                  : `${entry.finalUsageSeconds} seconds`}
              </div>
            </li>
          ))}
        </ol>
        <h3 className="mt-6 font-semibold">
          Recent events ({timeline.length}/100)
        </h3>
        <ol className="mt-3 space-y-3 break-all font-mono text-xs">
          {timeline.map((event, index) => (
            <li key={`${event.at}-${index}`}>
              {new Date(event.at).toLocaleTimeString()} · {event.kind}
              {event.tool ? ` · ${event.tool}` : ''}
              <br />
              {event.id ?? 'No correlation ID'}
              {event.provider ? ` · ${event.provider}` : ''}
              {event.providerInstanceId
                ? ` · instance ${event.providerInstanceId}`
                : ''}
              {event.state ? ` · ${event.state}` : ''}
              {event.status ? ` · HTTP ${event.status}` : ''}
              {event.generation === undefined
                ? ''
                : ` · generation ${event.generation}`}
              {event.ok === undefined
                ? ''
                : event.ok
                  ? ' · success'
                  : ' · failed'}
              {event.durationMs === undefined
                ? ''
                : ` · ${Math.round(event.durationMs)} ms`}
            </li>
          ))}
        </ol>
      </dialog>
    </>
  );
}
