import { OpenAILiveAdapter } from '@maelstrom-co/realtime-openai-live';
import { Activity, Bug, Fingerprint, Radio, X } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { demoVoiceSession } from '../lib/demo-voice';
import { diagnosticCapture } from '../lib/diagnostic-capture';
import { engineMetadata } from '../lib/engine-metadata';
import { m } from '../lib/maelstrom';
import { DEFAULT_REALTIME_MODEL } from '../lib/realtime-model';
import {
  projectLiveTransport,
  VoiceDiagnostics,
} from '../lib/voice-diagnostics';
import { LIVE_BACKEND_MODEL, LIVE_MODEL } from '../lib/voice-provider';
import { DiagnosticCapturePanel } from './diagnostic-capture-panel';
import { DiagnosticEvents } from './diagnostic-events';
import './voice-debug.css';

const sections = [
  { id: 'capture', label: 'Capture', icon: Radio },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'session', label: 'Session', icon: Fingerprint },
] as const;

function Facts({
  values,
}: {
  values: readonly (readonly [string, string | number])[];
}) {
  return (
    <dl className="debug-facts">
      {values.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function VoiceDebugDrawer() {
  const metadata = useSyncExternalStore(
    engineMetadata.subscribe,
    engineMetadata.getSnapshot,
    engineMetadata.getSnapshot,
  );
  const { session, provider } = m.useVoice();
  const { snapshot } = m.useVoiceObservations();
  const voice = demoVoiceSession(session);
  const diagnostics = voice?.diagnostics ?? NO_DIAGNOSTICS;
  const timeline = useSyncExternalStore(
    diagnostics.subscribe,
    diagnostics.getSnapshot,
    diagnostics.getSnapshot,
  );
  const history = useSyncExternalStore(
    diagnostics.subscribe,
    diagnostics.getTransportHistory,
    diagnostics.getTransportHistory,
  );
  const capture = useSyncExternalStore(
    diagnosticCapture.subscribe,
    diagnosticCapture.getSnapshot,
    diagnosticCapture.getSnapshot,
  );
  const [open, setOpen] = useState(false);
  const [section, setSection] =
    useState<(typeof sections)[number]['id']>('capture');
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [, refreshTransport] = useState(0);
  const transport =
    voice?.adapter instanceof OpenAILiveAdapter
      ? projectLiveTransport(voice.adapter.getTransportSnapshot())
      : undefined;
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(
      () => refreshTransport((value) => value + 1),
      1000,
    );
    return () => clearInterval(timer);
  }, [open]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const model =
    provider === 'live'
      ? LIVE_MODEL
      : provider === 'realtime'
        ? `${DEFAULT_REALTIME_MODEL} (default; active model unobserved)`
        : 'LiveKit cascade';
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="status-pill min-h-11 rounded-full px-3 text-xs text-ink-2"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        Debug{capture.active ? ' · Recording' : ''}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="voice-debug-title"
        onCancel={close}
        onClose={close}
        className="debug-drawer"
      >
        <header className="debug-header">
          <div className="debug-title">
            <Bug size={20} aria-hidden="true" />
            <div>
              <span className="debug-eyebrow">Playground tools</span>
              <h2 id="voice-debug-title">Diagnostics</h2>
            </div>
          </div>
          <button
            type="button"
            className="debug-button debug-close"
            aria-label="Close diagnostics"
            onClick={close}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <section className="debug-health" aria-label="Current status">
          <div>
            <span className="debug-eyebrow">Voice</span>
            <strong>
              <span
                className={`debug-dot ${snapshot.connection === 'connected' ? 'debug-dot-online' : ''}`}
              />
              {snapshot.connection}
            </strong>
          </div>
          <div>
            <span className="debug-eyebrow">Engine</span>
            <strong>
              {snapshot.applicationWork.planning === 'active'
                ? 'Planning'
                : snapshot.applicationWork.applying === 'active'
                  ? 'Applying'
                  : snapshot.applicationWork.planning === 'unknown' ||
                      snapshot.applicationWork.applying === 'unknown'
                    ? 'Unknown'
                    : 'Idle'}
            </strong>
          </div>
          <div>
            <span className="debug-eyebrow">Capture</span>
            <strong className={capture.active ? 'debug-recording-text' : ''}>
              {capture.active
                ? 'Recording'
                : capture.count > 0
                  ? 'Ready'
                  : 'Off'}
            </strong>
          </div>
        </section>
        <nav className="debug-nav" aria-label="Diagnostics views">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              aria-pressed={section === id}
              aria-controls={`debug-${id}`}
              onClick={() => setSection(id)}
            >
              <Icon size={15} aria-hidden="true" />
              {label}
              {id === 'activity' && <span>{timeline.length}</span>}
            </button>
          ))}
        </nav>
        <div className="debug-body">
          <div id="debug-capture" hidden={section !== 'capture'}>
            <DiagnosticCapturePanel />
          </div>
          <section
            id="debug-activity"
            hidden={section !== 'activity'}
            aria-labelledby="activity-title"
            className="debug-section"
          >
            <div className="debug-section-heading">
              <h3 id="activity-title">Live activity</h3>
              <span className="debug-badge">{timeline.length} / 100</span>
            </div>
            <p className="debug-help">
              Metadata only. Inspect a row for correlation IDs and timing.
              Request content is available only through an explicit capture.
            </p>
            <DiagnosticEvents events={timeline} label="Recent events" />
          </section>
          <section
            id="debug-session"
            hidden={section !== 'session'}
            aria-labelledby="session-title"
            className="debug-section"
          >
            <div className="debug-section-heading">
              <h3 id="session-title">Session details</h3>
              <span className="debug-badge">{provider}</span>
            </div>
            <h4 className="debug-eyebrow">Models</h4>
            <Facts
              values={[
                ['Voice', model],
                [
                  'Managed backend',
                  provider === 'live' ? LIVE_BACKEND_MODEL : 'Not applicable',
                ],
                ['Engine', metadata?.engineModel ?? 'Not reported by server'],
              ]}
            />
            <p className="debug-help">
              The Engine model is server-reported configuration, not
              provider-confirmed response metadata.
            </p>
            <h4 className="debug-eyebrow">Connection & media</h4>
            <Facts
              values={[
                ['Generation', snapshot.generation],
                ['Microphone', snapshot.media.microphone],
                ['Incoming audio', snapshot.media.incomingAudio],
                ['Engine planning', snapshot.applicationWork.planning],
                ['Application', snapshot.applicationWork.applying],
                ...(transport
                  ? ([
                      ['Playback', transport.playback],
                      ['Finalization', transport.finalization],
                      [
                        'Voice usage',
                        transport.usageSeconds === undefined
                          ? 'Not reported'
                          : `${transport.usageSeconds}s cumulative`,
                      ],
                      [
                        'Final voice usage',
                        transport.finalUsageSeconds === undefined
                          ? 'Not reported'
                          : `${transport.finalUsageSeconds}s`,
                      ],
                    ] as const)
                  : []),
              ]}
            />
            <details className="debug-disclosure">
              <summary>Session identifiers</summary>
              <Facts
                values={[
                  ['Application session', session.memory.sessionId],
                  [
                    'Provider instance',
                    voice?.providerInstanceId ?? 'Not reported',
                  ],
                  ['Provider session', transport?.sessionId ?? 'Not reported'],
                ]}
              />
            </details>
            <details className="debug-disclosure">
              <summary>
                Ended Live connections{' '}
                <span className="debug-badge">{history.length} / 16</span>
              </summary>
              {history.length === 0 ? (
                <p className="debug-help">
                  No ended Live connections in this application session.
                </p>
              ) : (
                <ol aria-label="Ended Live connections">
                  {history
                    .slice()
                    .reverse()
                    .map((entry) => (
                      <li
                        key={`${entry.providerInstanceId}:${entry.generation}`}
                      >
                        <Facts
                          values={[
                            [
                              'Voice / backend',
                              `${entry.model} / ${entry.backendModel}`,
                            ],
                            ['Instance', entry.providerInstanceId],
                            ['Generation', entry.generation],
                            ['Session', entry.sessionId ?? 'Not reported'],
                            ['Finalization', entry.finalization],
                            [
                              'Cumulative usage',
                              entry.usageSeconds === undefined
                                ? 'Not reported'
                                : `${entry.usageSeconds}s`,
                            ],
                            [
                              'Final usage',
                              entry.finalUsageSeconds === undefined
                                ? 'Not reported'
                                : `${entry.finalUsageSeconds}s`,
                            ],
                          ]}
                        />
                      </li>
                    ))}
                </ol>
              )}
            </details>
            <details className="debug-disclosure">
              <summary>Unobserved data</summary>
              <p className="debug-help">
                Backend and Engine usage, native delegation correlation,
                cancellation, and durable history are not exposed here. Missing
                data does not indicate success or zero usage.
              </p>
            </details>
          </section>
        </div>
        <footer className="debug-footer">
          <span className="debug-dot" />
          Browser-local diagnostics<span>Nothing uploads automatically</span>
        </footer>
      </dialog>
    </>
  );
}

const NO_DIAGNOSTICS = new VoiceDiagnostics();
