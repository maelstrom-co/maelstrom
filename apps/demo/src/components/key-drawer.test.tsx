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

  it('discloses that the key never reaches our servers, distinct from the local remember opt-in', () => {
    // The old copy ("we never store it") was false once "Remember on this
    // device" is ticked — that path writes the key to localStorage. This
    // pins the corrected wording, which disclaims server custody only.
    render(<KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />);
    expect(
      screen.getByText(
        'Your key goes straight to OpenAI — it never reaches our servers.',
      ),
    ).toBeTruthy();
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
    fireEvent.change(input, { target: { value: 'sk-test-key' } });

    const checkbox = screen.getByLabelText(
      /remember on this device/i,
    ) as HTMLInputElement;
    fireEvent.click(checkbox);

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith('sk-test-key', true);
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

  it('does not retain the typed key across a save/reopen cycle', () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <KeyDrawer isOpen onClose={() => {}} onSave={onSave} />,
    );

    const input = screen.getByLabelText(/api key/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'sk-typed-key' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith('sk-typed-key', false);

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
    fireEvent.change(input, { target: { value: 'sk-typed-key' } });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    rerender(<KeyDrawer isOpen={false} onClose={() => {}} onSave={() => {}} />);
    rerender(<KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />);

    const reopened = screen.getByLabelText(/api key/i) as HTMLInputElement;
    expect(reopened.value).toBe('');
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
