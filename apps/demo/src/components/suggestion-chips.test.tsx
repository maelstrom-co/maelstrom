// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMockConnector } from '../lib/__tests__/mock-connector';
import { CAPABILITY_NOTE } from './capability-note';
import { FIRST_RUN_EXAMPLES } from './first-run-hint';
import { SuggestionChipBand, SuggestionChips } from './suggestion-chips';

const { m } = await import('../lib/maelstrom');

const CHIP_LABELS = [
  'Add a design review task',
  'Write a journal entry',
  'Move the design review',
];

afterEach(() => cleanup());

function renderWithIntentInput(ui: React.ReactNode) {
  return render(
    <>
      {ui}
      <input id="demo-intent" aria-label="Intent" />
    </>,
  );
}

describe('SuggestionChipBand', () => {
  it('offers the work-focused examples as buttons in order', () => {
    renderWithIntentInput(
      <SuggestionChipBand isProcessing={false} onIntentChange={vi.fn()} />,
    );

    const chips = screen
      .getByRole('list', { name: 'Suggestions' })
      .querySelectorAll('button[data-suggestion]');
    expect([...chips].map((chip) => chip.textContent)).toEqual(CHIP_LABELS);
    expect([...chips].map((chip) => chip.getAttribute('title'))).toEqual([
      ...FIRST_RUN_EXAMPLES,
    ]);
  });

  it('fills the draft and focuses the intent input without submitting', () => {
    const onIntentChange = vi.fn();
    renderWithIntentInput(
      <SuggestionChipBand
        isProcessing={false}
        onIntentChange={onIntentChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: CHIP_LABELS[2] }));

    expect(onIntentChange).toHaveBeenCalledTimes(1);
    expect(onIntentChange).toHaveBeenCalledWith(FIRST_RUN_EXAMPLES[2]);
    expect(document.activeElement).toBe(screen.getByLabelText('Intent'));
  });

  it('uses native buttons in the tab order so the keyboard can reach them', () => {
    render(
      <SuggestionChipBand isProcessing={false} onIntentChange={vi.fn()} />,
    );

    for (const example of CHIP_LABELS) {
      const chip = screen.getByRole('button', { name: example });
      expect(chip.tagName).toBe('BUTTON');
      expect(chip.getAttribute('type')).toBe('button');
      expect(chip.tabIndex).toBe(0);
    }
  });

  it('hides the chips while a request is processing but keeps the band', () => {
    const { rerender } = render(
      <SuggestionChipBand isProcessing={false} onIntentChange={vi.fn()} />,
    );
    const band = screen.getByTestId('suggestion-chip-band');

    rerender(<SuggestionChipBand isProcessing onIntentChange={vi.fn()} />);

    expect(screen.getByTestId('suggestion-chip-band')).toBe(band);
    expect(screen.queryByRole('button', { name: CHIP_LABELS[0] })).toBeNull();
    expect(band.className).toContain('suggestion-chip-band');
  });

  it('says what the visitor can try', () => {
    render(
      <SuggestionChipBand isProcessing={false} onIntentChange={vi.fn()} />,
    );

    expect(CAPABILITY_NOTE).toBe(
      'Try adding tasks, writing journal entries or moving events.',
    );
    expect(screen.getByText(CAPABILITY_NOTE)).toBeTruthy();
  });

  it('keeps the capability note visible while chips are hidden', () => {
    render(<SuggestionChipBand isProcessing onIntentChange={vi.fn()} />);

    expect(screen.getByText(CAPABILITY_NOTE)).toBeTruthy();
  });

  it('describes the info button with the capability note and toggles it', () => {
    render(
      <SuggestionChipBand isProcessing={false} onIntentChange={vi.fn()} />,
    );
    const info = screen.getByRole('button', { name: 'What you can do' });

    expect(info.getAttribute('aria-describedby')).toBe(
      screen.getByText(CAPABILITY_NOTE).id,
    );
    expect(info.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(info);
    expect(info.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(info, { key: 'Escape' });
    expect(info.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('SuggestionChips', () => {
  it('renders the band inside a Maelstrom Provider while idle', () => {
    render(
      <m.Provider connector={createMockConnector()}>
        <SuggestionChips onIntentChange={vi.fn()} />
      </m.Provider>,
    );

    expect(screen.getByRole('button', { name: CHIP_LABELS[0] })).toBeTruthy();
  });
});
