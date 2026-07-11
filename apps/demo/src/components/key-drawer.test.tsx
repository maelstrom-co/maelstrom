// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyDrawer } from './key-drawer';

afterEach(cleanup);

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
});
