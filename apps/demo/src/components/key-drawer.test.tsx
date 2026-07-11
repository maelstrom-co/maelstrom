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

  it('shows the exact custody copy required by the spec', () => {
    render(<KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />);
    expect(
      screen.getByText('Your key goes to OpenAI — we never store it.'),
    ).toBeTruthy();
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
