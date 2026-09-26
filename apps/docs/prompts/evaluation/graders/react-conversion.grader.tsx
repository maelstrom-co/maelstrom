import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { search } = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('../src/search', () => ({ searchTickets: search }));

import { SearchPanel } from '../src/SearchPanel';
import { searchTickets } from '../src/search';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('trusted SearchPanel behavior contract', () => {
  it('controls the query and disables empty or whitespace-only submission', () => {
    render(<SearchPanel />);
    const input = screen.getByRole('textbox', { name: 'Search tickets' });
    const button = screen.getByRole('button', { name: 'Search' });
    expect(button).toBeDisabled();
    fireEvent.change(input, { target: { value: '   ' } });
    expect(input).toHaveValue('   ');
    expect(button).toBeDisabled();
    expect(searchTickets).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'ticket' } });
    const form = button.closest('form');
    expect(form).not.toBeNull();
    if (!form) throw new Error('Search form is missing');
    fireEvent.submit(form);
    expect(searchTickets).toHaveBeenCalledWith('ticket');
  });

  it('keeps pending state visible and disables duplicate submission until the app handler resolves', async () => {
    let finish!: (
      value: { id: string; subject: string; status: string }[],
    ) => void;
    search.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<SearchPanel />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tickets' }), {
      target: { value: 'billing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(
      await screen.findByRole('button', { name: 'Searching…' }),
    ).toBeDisabled();
    expect(searchTickets).toHaveBeenCalledTimes(1);
    expect(searchTickets).toHaveBeenCalledWith('billing');
    finish([{ id: 'T-104', subject: 'Billing address', status: 'Open' }]);
    expect(await screen.findByRole('status')).toHaveTextContent('1 results');
  });

  it('shows an application error after the handler rejects', async () => {
    search.mockRejectedValue(new Error('synthetic unavailable'));
    render(<SearchPanel />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tickets' }), {
      target: { value: 'billing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Search is temporarily unavailable.',
    );
  });

  it('shows the successful handler result and issues no browser request of its own', async () => {
    search.mockResolvedValue([
      { id: 'T-104', subject: 'Billing address', status: 'Open' },
    ]);
    render(<SearchPanel />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tickets' }), {
      target: { value: 'billing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('status')).toHaveTextContent('1 results');
    expect(searchTickets).toHaveBeenCalledWith('billing');
    expect(fetch).not.toHaveBeenCalled();
  });
});
