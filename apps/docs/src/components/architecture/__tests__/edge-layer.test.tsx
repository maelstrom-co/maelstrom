import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import { EdgeLayer } from '../EdgeLayer';
import { EDGES } from '../edges';
import type { LoopStep } from '../loop-machine';

// EdgeLayer draws beams from fixed stage coordinates (no DOM measuring), so it
// renders deterministically. It returns an SVG <g>, so mount it inside an <svg>.
function renderEdges(step: LoopStep) {
  return render(
    <svg>
      <title>Architecture edge layer test harness</title>
      <EdgeLayer currentStep={step} />
    </svg>,
  );
}

describe('EdgeLayer', () => {
  it('renders one flow path per edge', () => {
    const { container } = renderEdges('intent');
    expect(container.querySelectorAll('path[data-edge-id]')).toHaveLength(
      EDGES.length,
    );
  });

  it('renders a rail and a flow for every edge', () => {
    const { container } = renderEdges('intent');
    expect(container.querySelectorAll('.arch-rail')).toHaveLength(EDGES.length);
    expect(container.querySelectorAll('.arch-flow')).toHaveLength(EDGES.length);
  });

  it('classes the two spine segments as channel and the cluster as dependency', () => {
    const { container } = renderEdges('intent');
    expect(container.querySelectorAll('.arch-beam--channel')).toHaveLength(2);
    expect(container.querySelectorAll('.arch-beam--dependency')).toHaveLength(
      2,
    );
  });

  it('activates the channel and shows a packet during request (forward)', () => {
    const { container } = renderEdges('request');
    expect(container.querySelectorAll('.arch-flow--active')).toHaveLength(2);
    expect(container.querySelector('.arch-packet')).not.toBeNull();
    expect(container.querySelector('.arch-beam--reverse')).toBeNull();
  });

  it('reverses the channel during respond', () => {
    const { container } = renderEdges('respond');
    expect(container.querySelectorAll('.arch-beam--reverse')).toHaveLength(2);
    expect(container.querySelector('.arch-packet')).not.toBeNull();
  });

  it('shows no packet or active channel on apply beats', () => {
    const { container } = renderEdges('layout');
    expect(container.querySelector('.arch-packet')).toBeNull();
    expect(container.querySelector('.arch-flow--active')).toBeNull();
  });
});
