import { channelDirectionForStep, EDGES } from './edges';
import type { LoopStep } from './loop-machine';
import { anchor, POS } from './stage';

/** The packet path: client edge → through the protocol contract → engine edge. */
function channelPathD(): string {
  const { client, protocol, engine } = POS;
  const p0 = anchor(client, protocol.x, protocol.y);
  const p2 = anchor(engine, protocol.x, protocol.y);
  return `M${p0.x.toFixed(1)},${p0.y.toFixed(1)} L${protocol.x},${protocol.y} L${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
}

function Packet({ reverse }: { reverse: boolean }) {
  return (
    <circle
      className="arch-packet"
      r={6}
      style={{
        color: reverse ? 'var(--arch-beam-res)' : 'var(--arch-beam-req)',
      }}
    >
      <animateMotion
        dur="1.4s"
        repeatCount="indefinite"
        path={channelPathD()}
        keyPoints={reverse ? '1;0' : '0;1'}
        keyTimes="0;1"
        calcMode="spline"
        keySplines="0.45 0 0.2 1"
      />
    </circle>
  );
}

/**
 * Draws the connector beams from the fixed stage coordinates (no DOM
 * measurement). Each edge is a dim rail plus a flowing-light comet, anchored at
 * the node box edges. During the request/respond beats the channel spine
 * brightens and a packet travels client → protocol → engine (reversed on the
 * response). Decorative — aria-hidden; relationships are also in the role panel.
 */
export function EdgeLayer({ currentStep }: { currentStep: LoopStep }) {
  const dir = channelDirectionForStep(currentStep);
  const reverse = dir === 'reverse';

  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: an SVG <g> carries no default tabindex and is not focusable; the rule misreads it. The beams are decorative and the same relationships are exposed in the role panel, so dropping aria-hidden would only add noise.
    <g className="arch-edges" aria-hidden="true">
      {EDGES.map((edge, i) => {
        const a = POS[edge.from];
        const b = POS[edge.to];
        if (!a || !b) return null;
        const pa = anchor(a, b.x, b.y);
        const pb = anchor(b, a.x, a.y);
        const d = `M${pa.x.toFixed(1)},${pa.y.toFixed(1)} L${pb.x.toFixed(1)},${pb.y.toFixed(1)}`;
        const active = edge.kind === 'channel' && dir !== null;
        const beamClass = [
          'arch-beam',
          `arch-beam--${edge.kind}`,
          active ? 'arch-beam--active' : '',
          active && reverse ? 'arch-beam--reverse' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <g key={edge.id} className={beamClass}>
            <path className="arch-rail" d={d} />
            <path
              data-edge-id={edge.id}
              className={active ? 'arch-flow arch-flow--active' : 'arch-flow'}
              d={d}
              pathLength={100}
              style={{ animationDelay: `${i * -0.7}s` }}
            />
          </g>
        );
      })}
      {dir && <Packet reverse={reverse} />}
    </g>
  );
}
