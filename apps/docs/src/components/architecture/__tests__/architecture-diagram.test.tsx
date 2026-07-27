import { describe, expect, it } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import ArchitectureDiagram from '../ArchitectureDiagram';
import { STEPS, stepCaption } from '../loop-machine';
import { NODES } from '../nodes';

describe('ArchitectureDiagram — SSR fallback', () => {
  it('server-renders every package (scope + name) for no-JS and crawlers', () => {
    const html = renderToStaticMarkup(<ArchitectureDiagram />);
    // The label is split into a recessive scope span and an emphasised name
    // span, so assert each distinguishing name plus the shared scope.
    for (const n of NODES) {
      const name = n.label.slice(n.label.lastIndexOf('/') + 1);
      expect(html).toContain(name);
    }
    expect(html).toContain('@maelstrom-co/');
  });

  it('server-renders the runtime loop as an ordered list of beats in order', () => {
    const html = renderToStaticMarkup(<ArchitectureDiagram />);
    const positions = STEPS.map((s) => html.indexOf(stepCaption(s)));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions]).toEqual([...positions].sort((a, b) => a - b));
    expect(html).toContain('<ol');
  });
});

describe('ArchitectureDiagram — interaction', () => {
  it('reveals a node role when a node is focused', () => {
    render(<ArchitectureDiagram />);
    fireEvent.focus(screen.getByRole('button', { name: /protocol/i }));
    expect(screen.getByText(/message contract/i)).not.toBeNull();
  });

  it('advances the step caption when Next is pressed', () => {
    render(<ArchitectureDiagram />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    // The caption also appears in the always-rendered fallback <ol>, so scope the
    // assertion to the live stage subtitle.
    const subtitle = screen.getByText(stepCaption(STEPS[1]), {
      selector: '.arch-subtitle',
    });
    expect(subtitle).not.toBeNull();
  });

  it('stops pinning the detail panel to an explored node once the loop advances', () => {
    render(<ArchitectureDiagram />);
    // Explore a package while paused — the panel shows its role.
    fireEvent.focus(screen.getByRole('button', { name: /protocol/i }));
    expect(screen.getByText(/message contract/i)).not.toBeNull();
    // Advancing the loop clears the exploration; the panel narrates the beat
    // again instead of staying stuck on the package card.
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.queryByText(/message contract/i)).toBeNull();
  });
});
