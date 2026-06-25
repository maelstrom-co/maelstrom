import type { PackageNode } from './nodes';
import type { LoopStep } from './loop-machine';

interface BeatInfo {
  title: string;
  body: string;
  /** Real protocol field/type names surfaced as chips when details are shown. */
  fields: string[];
}

const BEAT_DETAIL: Record<LoopStep, BeatInfo> = {
  intent: {
    title: 'A reason to update',
    body: 'Something changes on the browser side. The client batches update reasons before it asks the engine for anything.',
    fields: ['user_intent', 'chart_resize', 'vessel_mutation'],
  },
  request: {
    title: 'ChartRequest',
    body: 'The client packages the batched reasons with the current state and sends it across to the engine.',
    fields: ['instances', 'chartDimensions (cells)', 'vessels', 'layoutMode'],
  },
  decide: {
    title: 'MaelstromResponse',
    body: 'The engine is stateless per request: it prompts an LLM and returns a plan plus a new layout.',
    fields: ['userMessage', 'rationale', 'executionPlan', 'layout'],
  },
  respond: {
    title: 'Response returns',
    body: 'The MaelstromResponse travels back across the protocol contract to the client.',
    fields: [],
  },
  layout: {
    title: 'set_layout',
    body: 'The client applies the new layout first — positions and sizes for every instance.',
    fields: ['positions', 'sizes'],
  },
  actions: {
    title: 'execute_actions',
    body: 'Then it runs the executionPlan. An action can flip a vessel to another variant via transitionsTo, and each variant declares its own minSize.',
    fields: ['ActionExecution', 'transitionsTo', 'minSize'],
  },
  observe: {
    title: 'ResizeObserver',
    body: "React re-renders, and the Chart's ResizeObserver floors the new pixel size to whole grid cells.",
    fields: ['pixels → cells'],
  },
  loop: {
    title: 'The loop closes',
    body: 'If the grid changed, that is a new chart_resize reason — and the whole round-trip runs again.',
    fields: ['chart_resize'],
  },
};

/**
 * The panel beneath the diagram. While exploring (a node is active and the loop
 * is paused) it shows that package's role; otherwise it narrates the current
 * beat, surfacing the real protocol field names when details are on.
 */
export function BeatDetail({
  node,
  step,
  showDetail,
}: {
  node: PackageNode | null;
  step: LoopStep;
  showDetail: boolean;
}) {
  if (node) {
    return (
      <div className="arch-detail" aria-live="polite">
        <h3 className="arch-detail__title">{node.label}</h3>
        <p className="arch-detail__body">{node.role}</p>
        {node.dependsOn.length > 0 && (
          <p className="arch-detail__meta">Depends on: {node.dependsOn.join(', ')}</p>
        )}
        <a className="arch-detail__link" href={node.deepDiveHref}>
          Learn more →
        </a>
      </div>
    );
  }

  const info = BEAT_DETAIL[step];
  return (
    <div className="arch-detail" aria-live="polite">
      <h3 className="arch-detail__title">{info.title}</h3>
      <p className="arch-detail__body">{info.body}</p>
      {showDetail && info.fields.length > 0 && (
        <ul className="arch-detail__fields">
          {info.fields.map((f) => (
            <li key={f}>
              <code>{f}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
