import { describe, it, expect, mock } from 'bun:test';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodeLayer } from '../NodeLayer';
import { NODES } from '../nodes';

// NodeLayer returns an SVG <g> of foreignObject cards, so mount it in an <svg>.
function renderNodes(props: Parameters<typeof NodeLayer>[0]) {
  return render(
    <svg>
      <NodeLayer {...props} />
    </svg>,
  );
}

describe('NodeLayer', () => {
  it('renders one button per package', () => {
    renderNodes({ activeId: null, onActivate: () => {} });
    expect(screen.getAllByRole('button').length).toBe(NODES.length);
  });

  it('calls onActivate with the node id on click', () => {
    const onActivate = mock(() => {});
    renderNodes({ activeId: null, onActivate });
    fireEvent.click(screen.getByRole('button', { name: /protocol/i }));
    expect(onActivate).toHaveBeenCalledWith('protocol');
  });

  it('calls onActivate on focus (keyboard reveal)', () => {
    const onActivate = mock(() => {});
    renderNodes({ activeId: null, onActivate });
    fireEvent.focus(screen.getByRole('button', { name: /engine/i }));
    expect(onActivate).toHaveBeenCalledWith('engine');
  });

  it('marks the active node with aria-pressed', () => {
    renderNodes({ activeId: 'client', onActivate: () => {} });
    const active = screen.getByRole('button', { name: /client/i });
    expect(active.getAttribute('aria-pressed')).toBe('true');
  });
});
