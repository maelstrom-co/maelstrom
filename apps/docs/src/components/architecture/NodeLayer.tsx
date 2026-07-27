import { NODES } from './nodes';
import { nodeRect, POS } from './stage';

/**
 * Renders the package cards as `foreignObject`s positioned in the stage's
 * coordinate space, so they share one space with the beams and scale with the
 * camera. Cards stay real HTML buttons (focusable, accessible).
 */
export function NodeLayer({
  activeId,
  onActivate,
}: {
  activeId: string | null;
  onActivate: (id: string) => void;
}) {
  return (
    <g className="arch-nodes">
      {NODES.map((n) => {
        const pos = POS[n.id];
        if (!pos) return null;
        const r = nodeRect(pos);
        // Split "@maelstrom-co/protocol" so the scope recedes and the package
        // name carries the emphasis.
        const slash = n.label.lastIndexOf('/');
        const scope = slash >= 0 ? n.label.slice(0, slash + 1) : '';
        const name = slash >= 0 ? n.label.slice(slash + 1) : n.label;
        return (
          <foreignObject
            key={n.id}
            className="arch-node-fo"
            x={r.x}
            y={r.y}
            width={r.width}
            height={r.height}
          >
            <button
              type="button"
              className={`arch-node arch-node--${n.tier}`}
              data-node-id={n.id}
              aria-pressed={activeId === n.id}
              onClick={() => onActivate(n.id)}
              onFocus={() => onActivate(n.id)}
            >
              {scope && <span className="arch-node__scope">{scope}</span>}
              <span className="arch-node__name">{name}</span>
            </button>
          </foreignObject>
        );
      })}
    </g>
  );
}
