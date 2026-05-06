import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { EnableVoiceDialog } from './enable-voice-dialog.js';

afterEach(() => cleanup());

// Note: happy-dom 20.x's QuerySelector trips on attribute selectors used
// by Testing Library's role queries (and by `container.querySelector`),
// throwing through an undefined `window.SyntaxError`. We sidestep both
// by walking the rendered tree with `getElementsByTagName` and reading
// attributes directly. The component is small enough that this stays
// readable.

function findFirstByRole(root: Element, role: string): Element | null {
  if (root.getAttribute('role') === role) return root;
  for (const child of Array.from(root.children)) {
    const hit = findFirstByRole(child, role);
    if (hit) return hit;
  }
  return null;
}

describe('EnableVoiceDialog', () => {
  it('renders the gesture affordance and forwards clicks to onEnable', () => {
    const onEnable = mock(() => {});
    const { container } = render(
      <EnableVoiceDialog onEnable={onEnable} voiceState="idle" />,
    );

    const dialog = findFirstByRole(container, 'dialog');
    expect(dialog).not.toBeNull();

    const buttons = container.getElementsByTagName('button');
    expect(buttons.length).toBe(1);
    fireEvent.click(buttons[0] as HTMLButtonElement);
    expect(onEnable).toHaveBeenCalledTimes(1);

    // No alert when voiceState is not 'error' — the affordance stays neutral.
    expect(findFirstByRole(container, 'alert')).toBeNull();
  });

  it('surfaces an alert and a Retry label when voiceState is "error"', () => {
    const onEnable = mock(() => {});
    const { container } = render(
      <EnableVoiceDialog onEnable={onEnable} voiceState="error" />,
    );

    const alert = findFirstByRole(container, 'alert');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain('Voice');
    expect(container.getElementsByTagName('button')[0]?.textContent).toBe(
      'Retry',
    );
  });
});
