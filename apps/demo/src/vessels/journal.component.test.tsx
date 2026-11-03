// @vitest-environment happy-dom

import type { TypedVesselProps } from '@maelstrom-co/react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetActionActivityForTests,
  getActivitySnapshot,
  latestReceiptParts,
} from '../lib/action-activity';
import { ACCENT_HEX, accentAlpha } from '../lib/design-tokens';
import { journalVessel } from './journal.vessel.def';

type Handler = (params?: Record<string, unknown>) => Promise<{
  ok: boolean;
  error?: Error;
}>;

const handlers = new Map<string, Record<string, Handler>>();

vi.mock('../lib/maelstrom', () => ({
  m: {
    useActions: (
      vesselId: string,
      _instanceId: string,
      runners: Record<string, Handler>,
    ) => {
      handlers.set(vesselId, runners);
    },
  },
}));

const { __resetJournalStoreForTests, getJournalSnapshot, journalActions } =
  await import('./journal.store');
const JournalComponent = (await import('./journal.component')).default;

const executeAction = vi.fn(
  async (action: string, params?: Record<string, unknown>) => {
    await handlers.get('journal')?.[action]?.(params);
  },
);

function props(
  variant: 'list' | 'entry',
): TypedVesselProps<typeof journalVessel> {
  return {
    instanceId: 'journal-test',
    variantProps: { variant },
    executeAction,
  } as unknown as TypedVesselProps<typeof journalVessel>;
}

function receipt(): string {
  return latestReceiptParts(getActivitySnapshot())
    .map((part) => part.text)
    .join(' · ');
}

function contentOf(id: string): string | undefined {
  return getJournalSnapshot().entries.find((entry) => entry.id === id)?.content;
}

async function invoke(action: string, params?: Record<string, unknown>) {
  const handler = handlers.get('journal')?.[action];
  if (!handler) throw new Error(`journal.${action} is not registered`);
  let result: Awaited<ReturnType<Handler>> | undefined;
  await act(async () => {
    result = await handler(params);
  });
  return result;
}

const TRANSITIONING_ACTIONS = new Set<string>(
  Object.values(journalVessel.variants).flatMap((variant) =>
    variant.actions
      .filter((action) => 'transitionsTo' in action && action.transitionsTo)
      .map((action) => action.name),
  ),
);

beforeEach(() => {
  handlers.clear();
  executeAction.mockClear();
  __resetJournalStoreForTests();
  __resetActionActivityForTests();
});

afterEach(cleanup);

describe('JournalComponent entry view ruled-paper', () => {
  beforeEach(() => {
    journalActions.openEntry('Sprint kickoff');
  });

  it('re-derives the rule color when VESSEL_ACCENTS.journal changes, proving it tracks the vessel accent rather than a hardcoded green literal', async () => {
    // journal's accent and RULE_COLOR both happen to be "green" today, so
    // asserting against the current values can't distinguish "reads
    // VESSEL_ACCENTS.journal" from "hardcodes green". Remounting the
    // component with VESSEL_ACCENTS.journal mocked to a different accent is
    // the only way to observe that the rule color follows the mapping.
    vi.resetModules();
    vi.doMock('../lib/design-tokens', async () => {
      const actual = await vi.importActual<
        typeof import('../lib/design-tokens')
      >('../lib/design-tokens');
      return {
        ...actual,
        VESSEL_ACCENTS: { ...actual.VESSEL_ACCENTS, journal: 'amber' },
      };
    });

    const { journalActions: mockedJournalActions } = await import(
      './journal.store'
    );
    mockedJournalActions.openEntry('Sprint kickoff');
    const MockedJournalComponent = (await import('./journal.component'))
      .default;

    const { container } = render(
      <MockedJournalComponent {...props('entry')} />,
    );
    const paper = container.querySelector('.ruled-paper') as HTMLElement;
    expect(paper.style.backgroundImage).toContain(
      accentAlpha(ACCENT_HEX.amber, 0.1),
    );
    expect(paper.style.backgroundImage).not.toContain(
      accentAlpha(ACCENT_HEX.green, 0.1),
    );

    vi.doUnmock('../lib/design-tokens');
    vi.resetModules();
  });

  it('sets a 26px line-height matching the 26px rule pitch, and drops leading-relaxed', () => {
    const { container } = render(<JournalComponent {...props('entry')} />);
    const paper = container.querySelector('.ruled-paper') as HTMLElement;
    expect(paper.style.lineHeight).toBe('26px');
    expect(paper.classList.contains('leading-relaxed')).toBe(false);
  });
});

describe('JournalComponent list view', () => {
  it('renders entries as buttons that open inline without an Action', () => {
    render(<JournalComponent {...props('list')} />);
    const row = screen.getByRole('button', { name: /Sprint kickoff/ });
    expect(row.getAttribute('aria-expanded')).toBe('false');

    act(() => {
      fireEvent.click(row);
    });

    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(getJournalSnapshot().activeEntryId).toBe('J-1');
    expect(executeAction).not.toHaveBeenCalled();
    const editor = screen.getByLabelText(
      'Text of Sprint kickoff',
    ) as HTMLTextAreaElement;
    expect(editor.tagName).toBe('TEXTAREA');
    expect(editor.value).toBe(contentOf('J-1'));
  });

  it('toggles a row through native button activation only', () => {
    render(<JournalComponent {...props('list')} />);
    const row = screen.getByRole('button', { name: /Architecture review/ });
    act(() => {
      fireEvent.keyDown(row, { key: ' ' });
    });
    expect(getJournalSnapshot().activeEntryId).toBeNull();

    act(() => {
      fireEvent.click(row);
    });
    expect(getJournalSnapshot().activeEntryId).toBe('J-2');

    act(() => {
      fireEvent.click(row);
    });
    expect(getJournalSnapshot().activeEntryId).toBeNull();
  });

  it('does not call an Action while typing', () => {
    render(<JournalComponent {...props('list')} />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Sprint kickoff/ }));
    });
    fireEvent.change(screen.getByLabelText('Text of Sprint kickoff'), {
      target: { value: 'Draft words' },
    });
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('saves through editEntry with the entry id and shows a receipt', async () => {
    render(<JournalComponent {...props('list')} />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Sprint kickoff/ }));
    });
    fireEvent.change(screen.getByLabelText('Text of Sprint kickoff'), {
      target: { value: 'Rewritten kickoff notes' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });

    expect(executeAction).toHaveBeenCalledWith('editEntry', {
      entry: 'J-1',
      content: 'Rewritten kickoff notes',
    });
    expect(contentOf('J-1')).toBe('Rewritten kickoff notes');
    expect(receipt()).toBe('✓ Updated journal entry "Sprint kickoff"');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /Sprint kickoff/ }),
    );
  });

  it('cancels with Escape, keeps the content and returns focus to the row', () => {
    render(<JournalComponent {...props('list')} />);
    const before = contentOf('J-1');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Sprint kickoff/ }));
    });
    const editor = screen.getByLabelText('Text of Sprint kickoff');
    fireEvent.change(editor, { target: { value: 'Throwaway' } });
    act(() => {
      fireEvent.keyDown(editor, { key: 'Escape' });
    });

    expect(screen.queryByLabelText('Text of Sprint kickoff')).toBeNull();
    expect(contentOf('J-1')).toBe(before);
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /Sprint kickoff/ }),
    );
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('keeps text typed after Save when the store confirms the earlier text', async () => {
    executeAction.mockImplementationOnce(async () => {});
    render(<JournalComponent {...props('list')} />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Sprint kickoff/ }));
    });
    const editor = screen.getByLabelText(
      'Text of Sprint kickoff',
    ) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'Queued words' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    fireEvent.change(editor, { target: { value: 'Queued words and more' } });

    await invoke('editEntry', { entry: 'J-1', content: 'Queued words' });

    expect(
      (screen.getByLabelText('Text of Sprint kickoff') as HTMLTextAreaElement)
        .value,
    ).toBe('Queued words and more');
    expect(
      (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it('keeps the draft and the open row until the store confirms the save', async () => {
    executeAction.mockImplementationOnce(async () => {});
    render(<JournalComponent {...props('list')} />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Sprint kickoff/ }));
    });
    fireEvent.change(screen.getByLabelText('Text of Sprint kickoff'), {
      target: { value: 'Queued words' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });

    const editor = screen.getByLabelText(
      'Text of Sprint kickoff',
    ) as HTMLTextAreaElement;
    expect(editor.value).toBe('Queued words');

    await invoke('editEntry', { entry: 'J-1', content: 'Queued words' });

    expect(screen.queryByLabelText('Text of Sprint kickoff')).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /Sprint kickoff/ }),
    );
  });

  it('keeps the draft when the save never lands', async () => {
    executeAction.mockImplementationOnce(async () => {});
    render(<JournalComponent {...props('list')} />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Sprint kickoff/ }));
    });
    fireEvent.change(screen.getByLabelText('Text of Sprint kickoff'), {
      target: { value: 'Unsaved words' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(
      (screen.getByLabelText('Text of Sprint kickoff') as HTMLTextAreaElement)
        .value,
    ).toBe('Unsaved words');
    expect(contentOf('J-1')).not.toBe('Unsaved words');
  });

  it('keeps an unsaved draft when another row opens', () => {
    render(<JournalComponent {...props('list')} />);
    const kickoff = screen.getByRole('button', { name: /Sprint kickoff/ });
    act(() => {
      fireEvent.click(kickoff);
    });
    fireEvent.change(screen.getByLabelText('Text of Sprint kickoff'), {
      target: { value: 'Unsaved kickoff words' },
    });
    act(() => {
      fireEvent.click(
        screen.getByRole('button', { name: /Architecture review/ }),
      );
    });
    expect(screen.queryByLabelText('Text of Sprint kickoff')).toBeNull();

    act(() => {
      fireEvent.click(kickoff);
    });
    expect(
      (screen.getByLabelText('Text of Sprint kickoff') as HTMLTextAreaElement)
        .value,
    ).toBe('Unsaved kickoff words');
  });

  it('drops the draft on Cancel so reopening shows the stored text', () => {
    render(<JournalComponent {...props('list')} />);
    const kickoff = screen.getByRole('button', { name: /Sprint kickoff/ });
    act(() => {
      fireEvent.click(kickoff);
    });
    fireEvent.change(screen.getByLabelText('Text of Sprint kickoff'), {
      target: { value: 'Throwaway' },
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    act(() => {
      fireEvent.click(kickoff);
    });
    expect(
      (screen.getByLabelText('Text of Sprint kickoff') as HTMLTextAreaElement)
        .value,
    ).toBe(contentOf('J-1'));
  });

  it('follows dictation again after a save confirmed with its row closed', async () => {
    executeAction.mockImplementationOnce(async () => {});
    render(<JournalComponent {...props('list')} />);
    const kickoff = screen.getByRole('button', { name: /Sprint kickoff/ });
    act(() => {
      fireEvent.click(kickoff);
    });
    fireEvent.change(screen.getByLabelText('Text of Sprint kickoff'), {
      target: { value: 'Saved words' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    act(() => {
      fireEvent.click(
        screen.getByRole('button', { name: /Architecture review/ }),
      );
    });
    await invoke('editEntry', { entry: 'J-1', content: 'Saved words' });

    act(() => {
      fireEvent.click(kickoff);
    });
    await invoke('writeContent', { text: 'Dictated words.' });
    expect(
      (screen.getByLabelText('Text of Sprint kickoff') as HTMLTextAreaElement)
        .value,
    ).toBe(contentOf('J-1'));
  });

  it('keeps a draft reverted to the stored text while its save is queued', async () => {
    executeAction.mockImplementationOnce(async () => {});
    render(<JournalComponent {...props('list')} />);
    const original = contentOf('J-1') ?? '';
    const kickoff = screen.getByRole('button', { name: /Sprint kickoff/ });
    act(() => {
      fireEvent.click(kickoff);
    });
    const editor = screen.getByLabelText('Text of Sprint kickoff');
    fireEvent.change(editor, { target: { value: 'Queued words' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    fireEvent.change(editor, { target: { value: original } });

    await invoke('createEntry', { title: 'Unrelated entry' });
    await invoke('editEntry', { entry: 'J-1', content: 'Queued words' });

    // createEntry selects the new entry, so the kickoff row is closed now.
    expect(screen.queryByLabelText('Text of Sprint kickoff')).toBeNull();
    act(() => {
      fireEvent.click(kickoff);
    });
    expect(
      (screen.getByLabelText('Text of Sprint kickoff') as HTMLTextAreaElement)
        .value,
    ).toBe(original);
  });

  it('cancels with the Cancel button', () => {
    render(<JournalComponent {...props('list')} />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Sprint kickoff/ }));
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    expect(screen.queryByLabelText('Text of Sprint kickoff')).toBeNull();
    expect(getJournalSnapshot().activeEntryId).toBeNull();
  });
});

describe('JournalComponent entry view editor', () => {
  it('edits the open entry through the same editEntry Action', async () => {
    journalActions.openEntry('J-2');
    render(<JournalComponent {...props('entry')} />);
    const editor = screen.getByLabelText('Text of Architecture review');
    fireEvent.change(editor, { target: { value: 'Split auth later' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(executeAction).toHaveBeenCalledWith('editEntry', {
      entry: 'J-2',
      content: 'Split auth later',
    });
    expect(contentOf('J-2')).toBe('Split auth later');
  });

  it('keeps the entry-view draft until the store confirms the save', async () => {
    executeAction.mockImplementationOnce(async () => {});
    journalActions.openEntry('J-2');
    render(<JournalComponent {...props('entry')} />);
    const editor = screen.getByLabelText(
      'Text of Architecture review',
    ) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'Pending words' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(editor.value).toBe('Pending words');
    expect(
      (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    await invoke('editEntry', { entry: 'J-2', content: 'Pending words' });
    expect(editor.value).toBe('Pending words');
    expect(
      (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('keeps an unsaved entry-view draft when a request opens another entry', async () => {
    journalActions.openEntry('J-1');
    render(<JournalComponent {...props('entry')} />);
    fireEvent.change(screen.getByLabelText('Text of Sprint kickoff'), {
      target: { value: 'Unsaved kickoff words' },
    });

    await invoke('openEntry', { title: 'J-2' });
    expect(screen.getByLabelText('Text of Architecture review')).toBeTruthy();
    await invoke('openEntry', { title: 'J-1' });

    expect(
      (screen.getByLabelText('Text of Sprint kickoff') as HTMLTextAreaElement)
        .value,
    ).toBe('Unsaved kickoff words');
  });

  it('gives each tile showing the same entry its own editor id', () => {
    journalActions.openEntry('J-1');
    render(
      <>
        <JournalComponent {...props('entry')} />
        <JournalComponent {...props('entry')} />
      </>,
    );
    const editors = screen.getAllByLabelText('Text of Sprint kickoff');
    expect(editors).toHaveLength(2);
    expect(editors[0].id).not.toBe(editors[1].id);
  });

  it('shows dictated text in the editor while there is no unsaved draft', async () => {
    journalActions.createEntry('Design review prep');
    render(<JournalComponent {...props('entry')} />);
    await invoke('writeContent', { text: 'Prototype checked.' });
    expect(
      (
        screen.getByLabelText(
          'Text of Design review prep',
        ) as HTMLTextAreaElement
      ).value,
    ).toBe('Prototype checked.');
  });

  it('never invokes an Action that switches Variant from a direct edit', async () => {
    journalActions.openEntry('J-1');
    render(<JournalComponent {...props('entry')} />);
    fireEvent.change(screen.getByLabelText('Text of Sprint kickoff'), {
      target: { value: 'Edited' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    for (const [action] of executeAction.mock.calls) {
      expect(TRANSITIONING_ACTIONS.has(action)).toBe(false);
    }
  });
});

describe('Journal Action handlers', () => {
  it('a request and a click reach the same editEntry handler', async () => {
    render(<JournalComponent {...props('list')} />);
    await invoke('editEntry', {
      entry: 'J-1 Sprint kickoff',
      content: 'From a request',
    });
    expect(contentOf('J-1')).toBe('From a request');
    expect(receipt()).toBe('✓ Updated journal entry "Sprint kickoff"');
  });

  it('records the create and write receipts for a dictated entry', async () => {
    render(<JournalComponent {...props('list')} />);
    await invoke('createEntry', { title: 'Design review prep' });
    await invoke('writeContent', {
      text: 'Prototype checked; questions still to prepare.',
    });
    const texts = getActivitySnapshot().entries.map((entry) => entry.text);
    expect(texts).toEqual([
      'Created journal entry "Design review prep"',
      'Wrote to "Design review prep"',
    ]);
  });

  it('fails an unknown entry with the current references', async () => {
    render(<JournalComponent {...props('list')} />);
    const result = await invoke('editEntry', {
      entry: 'Gym log',
      content: 'x',
    });
    expect(result?.ok).toBe(false);
    expect(result?.error?.message).toContain('J-1 Sprint kickoff');
    expect(receipt()).toBe('✗ Couldn\'t find journal entry "Gym log"');
  });

  it('fails writeContent with nothing open', async () => {
    render(<JournalComponent {...props('list')} />);
    const result = await invoke('writeContent', { text: 'Lost' });
    expect(result?.ok).toBe(false);
    expect(receipt()).toBe("✗ Couldn't write: no journal entry is open");
  });

  it('opens an entry by reference without recording a data change', async () => {
    render(<JournalComponent {...props('list')} />);
    const result = await invoke('openEntry', {
      title: 'J-2 Architecture review',
    });
    expect(result?.ok).toBe(true);
    expect(getJournalSnapshot().activeEntryId).toBe('J-2');
    expect(getActivitySnapshot().entries).toEqual([]);
  });
});
