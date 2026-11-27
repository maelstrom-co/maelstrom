// @vitest-environment happy-dom

import type { AdapterTurnControl } from '@maelstrom-co/realtime';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TurnModeToggle } from './turn-mode-toggle';

afterEach(cleanup);

function makeTurnControl(switchable: boolean): AdapterTurnControl {
  return {
    startTurn: vi.fn(async () => {}),
    endTurn: vi.fn(async () => {}),
    ...(switchable ? { setTurnMode: vi.fn(async () => {}) } : {}),
  };
}

describe('TurnModeToggle', () => {
  it('renders nothing without a control that can change mode', () => {
    const { container, rerender } = render(
      <TurnModeToggle turnControl={undefined} turnMode="automatic" />,
    );
    expect(container.children.length).toBe(0);

    rerender(
      <TurnModeToggle turnControl={makeTurnControl(false)} turnMode="manual" />,
    );
    expect(container.children.length).toBe(0);
  });

  it('turns hold to talk on in automatic mode and off in manual mode', () => {
    const turnControl = makeTurnControl(true);
    const { getByRole, rerender } = render(
      <TurnModeToggle turnControl={turnControl} turnMode="automatic" />,
    );
    const toggle = getByRole('switch', { name: 'Hold mode' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(turnControl.setTurnMode).toHaveBeenLastCalledWith('manual');

    rerender(<TurnModeToggle turnControl={turnControl} turnMode="manual" />);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(turnControl.setTurnMode).toHaveBeenLastCalledWith('automatic');
  });

  it('is disabled while the provider is switching', () => {
    const { getByRole } = render(
      <TurnModeToggle
        turnControl={makeTurnControl(true)}
        turnMode="automatic"
        switching
      />,
    );
    expect(
      (getByRole('switch', { name: 'Hold mode' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
