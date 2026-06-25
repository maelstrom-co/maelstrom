import { describe, it, expect, mock } from 'bun:test';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoopController } from '../LoopController';
import type { LoopState } from '../loop-machine';

function renderController(
  state: LoopState,
  overrides: Partial<{
    dispatch: () => void;
    showDetail: boolean;
    onToggleDetail: () => void;
  }> = {},
) {
  return render(
    <LoopController
      state={state}
      dispatch={overrides.dispatch ?? (() => {})}
      showDetail={overrides.showDetail ?? true}
      onToggleDetail={overrides.onToggleDetail ?? (() => {})}
    />,
  );
}

describe('LoopController', () => {
  it('dispatches next when Next is clicked', () => {
    const dispatch = mock(() => {});
    renderController({ index: 0, playing: false }, { dispatch });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'next' });
  });

  it('shows Pause while playing and dispatches pause', () => {
    const dispatch = mock(() => {});
    renderController({ index: 1, playing: true }, { dispatch });
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'pause' });
  });

  it('reflects detail state and toggles it', () => {
    const onToggleDetail = mock(() => {});
    renderController({ index: 0, playing: false }, { showDetail: true, onToggleDetail });
    const toggle = screen.getByRole('button', { name: /hide details/i });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(onToggleDetail).toHaveBeenCalled();
  });
});
