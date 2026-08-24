// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPlaygroundKey,
  playgroundKeyStore,
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

  it('explains that the browser keeps the key only for the page session', () => {
    render(<KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />);

    const drawer = screen.getByRole('dialog');
    expect(drawer.textContent).toContain('stays in browser memory');
    expect(drawer.textContent).toContain('disappears when you reload');
    expect(screen.queryByRole('checkbox', { name: /remember/i })).toBeNull();
  });

  it('does not claim the key never reaches our servers because the text path sends it to the Durable Object', () => {
    render(<KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />);
    const drawerText = screen.getByRole('dialog').textContent ?? '';
    expect(drawerText).not.toContain('never reaches our servers');
  });

  it('exposes dialog semantics with an accessible heading', () => {
    render(<KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />);
    const dialog = screen.getByRole('dialog', {
      name: /add your openai key/i,
    });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('moves focus to the API key input when opened', () => {
    render(<KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />);
    expect(document.activeElement).toBe(screen.getByLabelText(/api key/i));
  });

  it('closes on Escape so keyboard users are not trapped', () => {
    const onClose = vi.fn();
    render(<KeyDrawer isOpen onClose={onClose} onSave={() => {}} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('contains keyboard focus within the open dialog', () => {
    render(<KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />);
    const input = screen.getByLabelText(/api key/i) as HTMLElement;
    const cancel = screen.getByRole('button', { name: /cancel/i });

    cancel.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(input);

    input.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(cancel);
  });

  it('restores focus to the control that opened the dialog', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const { rerender } = render(
      <KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />,
    );

    rerender(<KeyDrawer isOpen={false} onClose={() => {}} onSave={() => {}} />);

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('passes only the trimmed key to onSave and does not persist it', () => {
    const onSave = vi.fn();
    render(<KeyDrawer isOpen onClose={() => {}} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: '  sk-test-key-1234567890  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith('sk-test-key-1234567890');
    expect(localStorage.length).toBe(0);
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

  it('links to local setup without discarding the current session', () => {
    render(<KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />);
    const link = screen.getByRole('link', { name: /run it locally instead/i });

    expect(link.getAttribute('href')).toContain('README');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('shows Remove key only when a key exists in memory', () => {
    const { rerender } = render(
      <KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />,
    );
    expect(screen.queryByRole('button', { name: /remove key/i })).toBeNull();

    setPlaygroundKey('sk-session-only');
    rerender(<KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />);

    expect(screen.getByRole('button', { name: /remove key/i })).toBeTruthy();
    const input = screen.getByLabelText(/api key/i) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('set for this session');
  });

  it('does not retain the typed key across a save and reopen cycle', () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <KeyDrawer isOpen onClose={() => {}} onSave={onSave} />,
    );

    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: 'sk-typed-key-1234567890' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    rerender(<KeyDrawer isOpen={false} onClose={() => {}} onSave={onSave} />);
    rerender(<KeyDrawer isOpen onClose={() => {}} onSave={onSave} />);

    expect((screen.getByLabelText(/api key/i) as HTMLInputElement).value).toBe(
      '',
    );
  });

  it('does not retain the typed key after Cancel', () => {
    const { rerender } = render(
      <KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />,
    );

    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: 'sk-typed-key-1234567890' },
    });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    rerender(<KeyDrawer isOpen={false} onClose={() => {}} onSave={() => {}} />);
    rerender(<KeyDrawer isOpen onClose={() => {}} onSave={() => {}} />);

    expect((screen.getByLabelText(/api key/i) as HTMLInputElement).value).toBe(
      '',
    );
  });

  it('rejects short values before they can corrupt redacted protocol frames', () => {
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

  it('Remove key clears the in-memory custody state', () => {
    setPlaygroundKey('sk-session-key');
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
    expect(playgroundKeyStore.state.apiKey).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});
