import { useId, useState } from 'react';
import './devtools-diagram.css';

const EVIDENCE_PATHS = [
  {
    id: 'browser',
    label: 'Browser metadata',
    summary:
      'The collector observes the existing client workflow. Optional voice integrations contribute projected metadata through the same channel.',
    steps: [
      {
        owner: 'Browser · application',
        title: 'Client and optional voice',
        body: 'Requests, layout application, Action outcomes, and connection changes produce observations.',
      },
      {
        owner: 'Browser · client',
        title: 'DiagnosticChannel',
        body: 'The Orchestrator exposes metadata to attached observers. Supported content stays lazy.',
      },
      {
        owner: 'Browser · devtools',
        title: 'Bounded collector',
        body: 'The core retains redacted evidence, grouped by app lifetime and request ID.',
      },
      {
        owner: 'Browser · shared panel',
        title: 'Inspect the workflow',
        body: 'Requests, Inspector, and Connections show observed outcomes beside the JSON.',
      },
    ],
  },
  {
    id: 'engine',
    label: 'Engine evidence',
    summary:
      'Server stages appear only when the host authorizes forwarding for the connection. Production Engine forwarding stays disabled, including with browser tools enabled.',
    steps: [
      {
        owner: 'Server · engine',
        title: 'createDiagnosticConnection',
        body: 'The host opts in and binds the authenticated session to this connection.',
      },
      {
        owner: 'Contract · protocol',
        title: 'Diagnostic frames',
        body: 'A compatible connector carries subscribed evidence for requests owned by this connection.',
      },
      {
        owner: 'Browser · devtools',
        title: 'Bounded collector',
        body: 'The core retains forwarded stages alongside local evidence. Missing stages remain unknown.',
      },
      {
        owner: 'Browser · shared panel',
        title: 'Inspect server stages',
        body: 'Read planner and validation evidence when available. The Engine imports no browser DevTools package.',
      },
    ],
  },
  {
    id: 'recording',
    label: 'Recorded content',
    summary:
      'Start recording before reproduction to retain supported content. Inspection filters do not change the selected recording scope. Nothing uploads automatically.',
    steps: [
      {
        owner: 'User · recording control',
        title: 'Choose scope and start',
        body: 'Choose an app lifetime or all app instances, then reproduce the problem.',
      },
      {
        owner: 'Observed sources',
        title: 'Supported content',
        body: 'The active capture requests lazy content. Earlier prompts and arguments cannot be recovered.',
      },
      {
        owner: 'Browser · devtools',
        title: 'Bounded capture store',
        body: 'Projection and redaction run before retention. Stop recording to inspect the evidence and add notes.',
      },
      {
        owner: 'User · JSON file',
        title: 'Export and reopen',
        body: 'Inspect and redact before sharing. Imported evidence is read-only and never replays Actions.',
      },
    ],
  },
] as const;

export default function DevtoolsDiagram() {
  const [selected, setSelected] = useState(0);
  const headingId = useId();
  const path = EVIDENCE_PATHS[selected];

  return (
    <section className="devtools-map" aria-labelledby={headingId}>
      <h3 id={headingId}>Follow an evidence path</h3>
      <fieldset className="devtools-map__choices">
        <legend>DevTools evidence paths</legend>
        {EVIDENCE_PATHS.map((item, index) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={selected === index}
            onClick={() => setSelected(index)}
          >
            {item.label}
          </button>
        ))}
      </fieldset>
      <div aria-live="polite" aria-atomic="true" data-evidence-path={path.id}>
        <p>{path.summary}</p>
        <ol className="devtools-map__flow" aria-label={path.label}>
          {path.steps.map((step) => (
            <li key={step.title} className="devtools-map__step">
              <span className="devtools-map__owner">{step.owner}</span>
              <strong>{step.title}</strong>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
      <p className="devtools-map__binding">
        <code>@maelstrom-co/react-devtools</code> owns React lifecycle wiring:
        attach before Provider connection, then mount <code>m.Devtools</code>.{' '}
        <code>@maelstrom-co/devtools</code> owns the framework-independent
        collector, capture store, and shared panel.
      </p>
      <details className="devtools-map__fallback">
        <summary>Read all three evidence paths</summary>
        {EVIDENCE_PATHS.map((item) => (
          <section key={item.id}>
            <h3>{item.label}</h3>
            <p>{item.summary}</p>
            <ol>
              {item.steps.map((step) => (
                <li key={step.title}>
                  <strong>{step.title}</strong> — {step.body}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </details>
    </section>
  );
}
