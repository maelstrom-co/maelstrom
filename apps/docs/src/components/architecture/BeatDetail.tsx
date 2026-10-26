import type { LoopStep } from './loop-machine';
import type { PackageNode } from './nodes';

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
    body: 'The client puts the batched reasons and current Chart state in a ChartRequestMessage with a session ID, message ID, and timestamp.',
    fields: [
      'instances',
      'layout',
      'chartDimensions (cells)',
      'vessels',
      'layoutMode',
    ],
  },
  decide: {
    title: 'Planning and validation',
    body: 'The configured Planner proposes a layout and Actions. The Engine validates the candidate and repairs recoverable problems. History is available when configured.',
    fields: ['userMessage', 'rationale', 'executionPlan', 'layout'],
  },
  respond: {
    title: 'Response returns',
    body: 'The host maps the Engine result to a server envelope. The connector decodes it and delivers the MaelstromResponse to the client.',
    fields: [],
  },
  layout: {
    title: 'set_layout',
    body: 'The client applies the layout first. In tiling mode, this establishes the retained Instances and the tree that controls visibility.',
    fields: ['layout', 'instances', 'positions', 'tree'],
  },
  actions: {
    title: 'execute_actions',
    body: 'The client runs the executionPlan after the layout is applied, so an Action can target an Instance introduced by the same response.',
    fields: ['ActionExecution', 'transitionsTo'],
  },
  observe: {
    title: 'ResizeObserver',
    body: "The Chart's ResizeObserver watches the container and converts its pixel dimensions to whole grid cells.",
    fields: ['pixels → cells'],
  },
  loop: {
    title: 'The loop closes',
    body: 'If the whole-cell dimensions change, the client sends a chart_resize request. It starts a separate Engine turn.',
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
          <p className="arch-detail__meta">
            Depends on: {node.dependsOn.join(', ')}
          </p>
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
