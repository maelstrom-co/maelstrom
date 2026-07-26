// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { ACCENT_HEX, accentAlpha } from '../lib/design-tokens';
import type { journalVessel } from './journal.vessel';

vi.mock('../lib/maelstrom', () => ({
  m: { useActions: vi.fn() },
}));

const { journalActions } = await import('./journal.store');
const JournalComponent = (await import('./journal.component')).default;

function props(): TypedVesselProps<typeof journalVessel> {
  return {
    instanceId: 'journal-test',
    variantProps: { variant: 'entry' },
    executeAction: vi.fn(),
  } as unknown as TypedVesselProps<typeof journalVessel>;
}

beforeEach(() => {
  journalActions.openEntry('Sprint kickoff');
});

afterEach(cleanup);

describe('JournalComponent entry view ruled-paper', () => {
  it('re-derives the rule color when VESSEL_ACCENTS.journal changes, proving it tracks the vessel accent rather than a hardcoded green literal', async () => {
    // journal's accent and RULE_COLOR both happen to be "green" today, so
    // asserting against the current values can't distinguish "reads
    // VESSEL_ACCENTS.journal" from "hardcodes green" — the exact bug this fix
    // closes. Remounting the component with VESSEL_ACCENTS.journal mocked to
    // a different accent is the only way to observe that the rule color
    // actually follows the mapping.
    vi.resetModules();
    vi.doMock('../lib/design-tokens', async () => {
      const actual = await vi.importActual<typeof import('../lib/design-tokens')>(
        '../lib/design-tokens',
      );
      return {
        ...actual,
        VESSEL_ACCENTS: { ...actual.VESSEL_ACCENTS, journal: 'amber' },
      };
    });

    const { journalActions: mockedJournalActions } = await import('./journal.store');
    mockedJournalActions.openEntry('Sprint kickoff');
    const MockedJournalComponent = (await import('./journal.component')).default;

    const { container } = render(<MockedJournalComponent {...props()} />);
    const paper = container.querySelector('.ruled-paper') as HTMLElement;
    expect(paper.style.backgroundImage).toContain(accentAlpha(ACCENT_HEX.amber, 0.1));
    expect(paper.style.backgroundImage).not.toContain(accentAlpha(ACCENT_HEX.green, 0.1));

    vi.doUnmock('../lib/design-tokens');
    vi.resetModules();
  });

  it('sets a 26px line-height matching the 26px rule pitch, and drops leading-relaxed', () => {
    // The gradient repeats every 26px; text-sm leading-relaxed is 22.75px,
    // so rules drifted off the text baseline by line 4-5. An explicit inline
    // lineHeight keeps the two pitches locked together.
    const { container } = render(<JournalComponent {...props()} />);
    const paper = container.querySelector('.ruled-paper') as HTMLElement;
    expect(paper.style.lineHeight).toBe('26px');
    expect(paper.classList.contains('leading-relaxed')).toBe(false);
  });
});
