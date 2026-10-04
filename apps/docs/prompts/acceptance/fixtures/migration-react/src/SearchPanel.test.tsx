import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { SearchPanel } from './SearchPanel';

describe('SearchPanel baseline', () => {
  it('keeps empty submission unavailable and renders stub search results', async () => {
    render(<SearchPanel />);
    const search = screen.getByRole('button', { name: 'Search' });
    expect(search).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Search tickets'), {
      target: { value: 'billing' },
    });
    expect(search).toBeEnabled();
    fireEvent.submit(
      screen.getByRole('button', { name: 'Search' }).closest('form')!,
    );
    expect(await screen.findByRole('status')).toHaveTextContent('1 results');
  });
});
