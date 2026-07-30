// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPlaygroundKey,
  setPlaygroundKey,
} from '../lib/playground-key-store';
import { KeyDrawer } from './key-drawer';

beforeEach(() => {
  localStorage.clear();
  clearPlaygroundKey();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  clearPlaygroundKey();
});

describe('KeyDrawer', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <KeyDrawer isOpen={false} onClose={() => {}} onSave={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('does not claim the key never reaches our servers, since the text path sends it to the Durable Object over playground.hello', () => {
    // The old copy ("your key never reaches our servers") was false for the
    // text path: session-do.ts holds the key in memory per connection
    // (`#keys`, a WeakMap<WebSocket, string>) and drops it — deliberately,
    // never persisted — whenever the object hibernates, re-requesting it via
    // playground.rehello on wake. It still reaches the server. Pinning the
    // absence of the absolute claim (rather than the exact sentence) so this
    // survives future wording tweaks but still catches a regression back to
    // an inaccurate privacy claim.
    render(<KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />);
    const drawerText = screen.getByRole('dialog').textContent ?? '';
    expect(drawerText).not.toContain('never reaches our servers');
  });

  it('exposes dialog semantics with an accessible name pointing at the heading', () => {
    render(<KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />);
    const dialog = screen.getByRole('dialog', {
      name: /add your openai key/i,
    });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('moves focus to the API key input when opened, so keyboard users are not left tabbing behind it', () => {
    render(<KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />);
    const input = screen.getByLabelText(/api key/i);
    expect(document.activeElement).toBe(input);
  });

  it('closes on Escape, so keyboard-only visitors are never stuck behind a mouse-only drawer', () => {
    const onClose = vi.fn();
    render(<KeyDrawer isOpen onClose={onClose} onSave={() => {}} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onSave with the pasted key and the remember checkbox state', () => {
    const onSave = vi.fn();
    render(<KeyDrawer isOpen onClose={() => {}} onSave={onSave} />);

    const input = screen.getByLabelText(/api key/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'sk-test-key-1234567890' } });

    const checkbox = screen.getByLabelText(
      /remember on this device/i,
    ) as HTMLInputElement;
    fireEvent.click(checkbox);

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith('sk-test-key-1234567890', true);
  });

  it('surfaces an error message when provided', () => {
    render(
      <KeyDrawer
        isOpen
        onClose={() => {}}
        onSave={() => {}}
        errorMessage="Invalid API key."
      />,
    );
    expect(screen.getByText('Invalid API key.')).toBeTruthy();
  });

  it('renders the "run it locally instead" link to the repo README', () => {
    render(<KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />);
    const link = screen.getByRole('link', { name: /run it locally instead/i });
    expect(link.getAttribute('href')).toContain('README');
  });

  it('opens "run it locally instead" in a new tab, so it does not discard the visitor\'s in-progress session', () => {
    render(<KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />);
    const link = screen.getByRole('link', { name: /run it locally instead/i });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('does not show a "Remove key" action when no key is stored', () => {
    render(<KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />);
    expect(screen.queryByRole('button', { name: /remove key/i })).toBeNull();
  });

  it('shows a masked placeholder instead of the stored key when one is saved', () => {
    setPlaygroundKey('sk-stored', true);
    render(<KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />);

    const input = screen.getByLabelText(/api key/i) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('saved on this device');
  });

  it('does not claim a session-only key is "saved on this device", since it was never written to localStorage', () => {
    // Same class of custody-copy bug this drawer's other text was already
    // fixed for: a visitor who declined "Remember on this device" has a key
    // in memory only, and telling them it's "saved on this device" misstates
    // where it actually lives.
    setPlaygroundKey('sk-session-only', false);
    render(<KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />);

    const input = screen.getByLabelText(/api key/i) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).not.toBe('saved on this device');
    expect(input.placeholder).toBe('set for this session');
  });

  it('does not retain the typed key across a save/reopen cycle', () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <KeyDrawer isOpen onClose={() => {}} onSave={onSave} />,
    );

    const input = screen.getByLabelText(/api key/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'sk-typed-key-1234567890' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith('sk-typed-key-1234567890', false);

    // Simulate the drawer closing and reopening (isOpen: true -> false -> true).
    rerender(<KeyDrawer isOpen={false} onClose={() => {}} onSave={onSave} />);
    rerender(<KeyDrawer isOpen onClose={() => {}} onSave={onSave} />);

    const reopened = screen.getByLabelText(/api key/i) as HTMLInputElement;
    expect(reopened.value).toBe('');
  });

  it('does not retain the typed key after Cancel', () => {
    const { rerender } = render(
      <KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />,
    );

    const input = screen.getByLabelText(/api key/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'sk-typed-key-1234567890' } });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    rerender(<KeyDrawer isOpen={false} onClose={() => {}} onSave={() => {}} />);
    rerender(<KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />);

    const reopened = screen.getByLabelText(/api key/i) as HTMLInputElement;
    expect(reopened.value).toBe('');
  });

  it('does not retain a ticked "remember" checkbox after Cancel', () => {
    // The drawer stays mounted across open/close, so an un-reset `remember`
    // would silently persist the NEXT key to localStorage without fresh
    // consent — the exact scenario this component's own doc comment says
    // cannot happen ("the key only touches localStorage if the visitor
    // explicitly asks for it").
    const onSave = vi.fn();
    const { rerender } = render(
      <KeyDrawer isOpen onClose={() => {}} onSave={onSave} />,
    );

    const checkbox = screen.getByLabelText(
      /remember on this device/i,
    ) as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    rerender(<KeyDrawer isOpen={false} onClose={() => {}} onSave={onSave} />);
    rerender(<KeyDrawer isOpen onClose={() => {}} onSave={onSave} />);

    const reopenedCheckbox = screen.getByLabelText(
      /remember on this device/i,
    ) as HTMLInputElement;
    expect(reopenedCheckbox.checked).toBe(false);

    const input = screen.getByLabelText(/api key/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'sk-second-visit-key12' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith('sk-second-visit-key12', false);
  });

  it('does not retain a ticked "remember" checkbox after Remove', () => {
    setPlaygroundKey('sk-stored-1234567890', true);
    const onRemove = vi.fn(() => clearPlaygroundKey());
    const { rerender } = render(
      <KeyDrawer
        isOpen
        onClose={() => {}}
        onSave={() => {}}
        onRemove={onRemove}
      />,
    );

    const checkbox = screen.getByLabelText(
      /remember on this device/i,
    ) as HTMLInputElement;
    fireEvent.click(checkbox);

    fireEvent.click(screen.getByRole('button', { name: /remove key/i }));

    rerender(
      <KeyDrawer
        isOpen={false}
        onClose={() => {}}
        onSave={() => {}}
        onRemove={onRemove}
      />,
    );
    rerender(
      <KeyDrawer
        isOpen
        onClose={() => {}}
        onSave={() => {}}
        onRemove={onRemove}
      />,
    );

    const reopenedCheckbox = screen.getByLabelText(
      /remember on this device/i,
    ) as HTMLInputElement;
    expect(reopenedCheckbox.checked).toBe(false);
  });

  it('disables Save for a key shorter than 20 characters, and shows a hint only once the field is non-empty', () => {
    // A too-short key still passes the server's exact-substring redaction
    // match against every outbound frame — a 1-3 char "key" rewrites
    // unrelated wire content (e.g. "executionPlan") and the reply becomes
    // undecodable, hanging the request until the correlator timeout instead
    // of surfacing "Invalid API key" like a real bad key would.
    render(<KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />);

    const input = screen.getByLabelText(/api key/i) as HTMLInputElement;
    const saveButton = screen.getByRole('button', {
      name: /save/i,
    }) as HTMLButtonElement;

    expect(saveButton.disabled).toBe(true);
    expect(screen.queryByText(/at least 20 characters/i)).toBeNull();

    fireEvent.change(input, { target: { value: 'sk-short' } });
    expect(saveButton.disabled).toBe(true);
    expect(screen.getByText(/at least 20 characters/i)).toBeTruthy();

    fireEvent.change(input, { target: { value: 'sk-long-enough-key-123456' } });
    expect(saveButton.disabled).toBe(false);
    expect(screen.queryByText(/at least 20 characters/i)).toBeNull();
  });

  it('"Remove key" calls onRemove, which the caller wires to clear the store and localStorage', () => {
    setPlaygroundKey('sk-stored', true);
    // Mirrors index.tsx's real wiring — the drawer only invokes the
    // callback; clearing custody state is the caller's responsibility.
    const onRemove = vi.fn(() => clearPlaygroundKey());
    render(
      <KeyDrawer
        isOpen
        onClose={() => {}}
        onSave={() => {}}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /remove key/i }));

    expect(onRemove).toHaveBeenCalledOnce();
    expect(localStorage.getItem('maelstrom-playground-key')).toBeNull();
  });
});
