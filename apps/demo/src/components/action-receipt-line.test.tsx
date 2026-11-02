// @vitest-environment happy-dom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetActionActivityForTests,
  beginRequestWindow,
  endRequestWindow,
  recordChange,
  recordFailure,
} from '../lib/action-activity';
import { ActionReceiptLine } from './action-receipt-line';

beforeEach(() => {
  __resetActionActivityForTests();
});

afterEach(cleanup);

describe('ActionReceiptLine', () => {
  it('always renders the fixed one-line band, empty when nothing changed', () => {
    render(<ActionReceiptLine />);
    const band = screen.getByTestId('action-receipt-line');
    expect(band.classList.contains('action-receipt-line')).toBe(true);
    expect(band.classList.contains('h-6')).toBe(true);
    expect(band.textContent).toBe('');
    expect(band.getAttribute('title')).toBeNull();
  });

  it('is a polite live region', () => {
    render(<ActionReceiptLine />);
    expect(
      screen.getByTestId('action-receipt-line').getAttribute('aria-live'),
    ).toBe('polite');
  });

  it('shows the latest receipt with the full text as a tooltip', () => {
    render(<ActionReceiptLine />);
    act(() => {
      const windowId = beginRequestWindow();
      recordChange('Created journal entry "Design review prep"', {
        vesselId: 'journal',
        action: 'createEntry',
      });
      recordChange('Wrote to "Design review prep"', {
        vesselId: 'journal',
        action: 'writeContent',
      });
      endRequestWindow(windowId);
    });
    const band = screen.getByTestId('action-receipt-line');
    const text =
      '✓ Created journal entry "Design review prep" · ✓ Wrote to "Design review prep"';
    expect(band.textContent).toBe(text);
    expect(band.getAttribute('title')).toBe(text);
  });

  it('marks failures with the problem tone', () => {
    render(<ActionReceiptLine />);
    act(() => {
      recordFailure('Couldn\'t find task "gym"', {
        vesselId: 'tasks',
        action: 'checkTask',
      });
    });
    const problem = screen.getByText('✗ Couldn\'t find task "gym"');
    expect(problem.getAttribute('data-tone')).toBe('problem');
  });

  it('keeps the band mounted and empties it after a layout-only request', () => {
    render(<ActionReceiptLine />);
    act(() => {
      recordChange('Added "A"', { vesselId: 'tasks', action: 'addTask' });
    });
    expect(screen.getByTestId('action-receipt-line').textContent).toBe(
      '✓ Added "A"',
    );
    act(() => {
      endRequestWindow(beginRequestWindow('ticket-1'));
    });
    const band = screen.getByTestId('action-receipt-line');
    expect(band.textContent).toBe('');
    expect(band.classList.contains('h-6')).toBe(true);
  });
});
