import type {
  ActionParameter,
  VesselActionDefinition,
} from '@maelstrom-co/protocol';
import { defineVessel } from '@maelstrom-co/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withActionOptions } from './vessel-options';

// `defineVessel`'s `<const V>` generic infers parameter objects as their
// exact input literal — a fixture that never mentions `enum` has no `enum`
// key in its static type. Casting the fixture arrays to `ActionParameter[]`
// widens them so the assertions below (which read `.enum`, the very thing
// `withActionOptions` adds) typecheck.

// The fixture deliberately carries fields `withActionOptions` never touches
// — per-variant `props`/`minSize`, an action-level `transitionsTo`, and an
// action with no `parameters` at all — because the function's contract is
// "the same vessel, plus the injected enums". A rebuild that reconstructed
// variants or actions field-by-field instead of spreading them would drop
// exactly these, and the running app would end up with variants that have no
// minSize (grid healing stops rejecting undersized placements) or actions
// that no longer transition.
const journalVessel = defineVessel({
  id: 'journal',
  name: 'Journal',
  description: 'Journal',
  defaultVariant: 'list',
  variants: {
    list: {
      props: { density: 'compact' },
      minSize: { width: 1, height: 1 },
      actions: [
        {
          name: 'openEntry',
          description: 'Open an entry',
          transitionsTo: 'entry',
          parameters: [
            { name: 'title', type: 'string', description: 'Entry title' },
          ] as ActionParameter[],
        },
        {
          name: 'createEntry',
          description: 'Create an entry',
          parameters: [
            { name: 'title', type: 'string', description: 'New title' },
          ] as ActionParameter[],
        },
        // Widened to the interface so the literal type carries an optional
        // `parameters` key; the runtime object genuinely has none, which is
        // the `!action.parameters` branch this fixture exists to reach.
        {
          name: 'closeEntry',
          description: 'Close the open entry',
        } as VesselActionDefinition,
      ],
    },
    entry: {
      props: { density: 'full' },
      minSize: { width: 2, height: 2 },
      actions: [
        {
          name: 'openEntry',
          description: 'Open an entry',
          transitionsTo: 'entry',
          parameters: [
            { name: 'title', type: 'string', description: 'Entry title' },
          ] as ActionParameter[],
        },
      ],
    },
  },
});

describe('withActionOptions', () => {
  it('injects options into every variant that declares the action', () => {
    const updated = withActionOptions(journalVessel, {
      openEntry: { title: ['Sprint kickoff', 'Architecture review'] },
    });

    for (const variantName of ['list', 'entry'] as const) {
      const action = updated.variants[variantName].actions.find(
        (a) => a.name === 'openEntry',
      );
      expect(action?.parameters?.[0]?.enum).toEqual([
        'Sprint kickoff',
        'Architecture review',
      ]);
    }
  });

  it('leaves unnamed actions and parameters untouched', () => {
    const updated = withActionOptions(journalVessel, {
      openEntry: { title: ['Sprint kickoff'] },
    });

    const createEntry = updated.variants.list.actions.find(
      (a) => a.name === 'createEntry',
    );
    // createEntry names something that does not exist yet — constraining it to
    // existing titles would make it impossible to create anything new.
    expect(createEntry?.parameters?.[0]).not.toHaveProperty('enum');
  });

  it('omits the enum key entirely when the option list is empty', () => {
    // enum: [] would serialize into the prompt as a bare `title: ` with
    // neither values nor a type — worse than declaring no enum at all.
    const updated = withActionOptions(journalVessel, {
      openEntry: { title: [] },
    });

    const action = updated.variants.list.actions.find(
      (a) => a.name === 'openEntry',
    );
    expect(action?.parameters?.[0]).not.toHaveProperty('enum');
  });

  it('returns a vessel identical to the source apart from the injected enum', () => {
    const updated = withActionOptions(journalVessel, {
      openEntry: { title: ['Sprint kickoff'] },
    });

    // Restated in full rather than derived from the fixture: a rebuild that
    // dropped minSize/props/transitionsTo would still satisfy any assertion
    // computed from the same source object.
    expect(updated).toEqual({
      id: 'journal',
      name: 'Journal',
      description: 'Journal',
      defaultVariant: 'list',
      variants: {
        list: {
          props: { density: 'compact' },
          minSize: { width: 1, height: 1 },
          actions: [
            {
              name: 'openEntry',
              description: 'Open an entry',
              transitionsTo: 'entry',
              parameters: [
                {
                  name: 'title',
                  type: 'string',
                  description: 'Entry title',
                  enum: ['Sprint kickoff'],
                },
              ],
            },
            {
              name: 'createEntry',
              description: 'Create an entry',
              parameters: [
                { name: 'title', type: 'string', description: 'New title' },
              ],
            },
            { name: 'closeEntry', description: 'Close the open entry' },
          ],
        },
        entry: {
          props: { density: 'full' },
          minSize: { width: 2, height: 2 },
          actions: [
            {
              name: 'openEntry',
              description: 'Open an entry',
              transitionsTo: 'entry',
              parameters: [
                {
                  name: 'title',
                  type: 'string',
                  description: 'Entry title',
                  enum: ['Sprint kickoff'],
                },
              ],
            },
          ],
        },
      },
    });
  });

  // The injector's `!action.parameters` half and the warner disagree on this
  // input by design: the injector has nothing to inject into and no-ops,
  // while the warner still reports the key as dead. Both halves are pinned
  // here so neither drifts into silence.
  it('leaves an action with no parameters untouched, and still warns the option key is dead', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const updated = withActionOptions(journalVessel, {
      closeEntry: { title: ['Sprint kickoff'] },
    });

    const closeEntry = updated.variants.list.actions.find(
      (a) => a.name === 'closeEntry',
    );
    expect(closeEntry).toEqual({
      name: 'closeEntry',
      description: 'Close the open entry',
    });
    expect(closeEntry).not.toHaveProperty('parameters');

    expect(warn).toHaveBeenCalledTimes(1);
    const [message] = warn.mock.calls[0] ?? [];
    expect(String(message)).toContain('journal');
    expect(String(message)).toContain('closeEntry');
    expect(String(message)).toContain('title');
    warn.mockRestore();
  });

  it('does not mutate the source definition', () => {
    withActionOptions(journalVessel, { openEntry: { title: ['x'] } });

    const original = journalVessel.variants.list.actions.find(
      (a) => a.name === 'openEntry',
    );
    expect(original?.parameters?.[0]).not.toHaveProperty('enum');
  });

  describe('unmatched option keys', () => {
    // `options` keys are plain strings (ActionOptions is a Record, not
    // checked against the vessel's own action/parameter names), so renaming
    // an action or parameter in the vessel definition and forgetting to
    // update the caller's `options` object typechecks fine and no-ops
    // forever — the only symptom is the engine quietly inventing values
    // again. This is the runtime guard for that: it must at least warn.
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('warns naming the vessel and the key when no action matches', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      withActionOptions(journalVessel, {
        renamedAction: { title: ['x'] },
      });

      expect(warn).toHaveBeenCalledTimes(1);
      const [message] = warn.mock.calls[0] ?? [];
      expect(String(message)).toContain('journal');
      expect(String(message)).toContain('renamedAction');
    });

    it('warns naming the vessel and the key when the action matches but no parameter does', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      withActionOptions(journalVessel, {
        openEntry: { renamedParameter: ['x'] },
      });

      expect(warn).toHaveBeenCalledTimes(1);
      const [message] = warn.mock.calls[0] ?? [];
      expect(String(message)).toContain('journal');
      expect(String(message)).toContain('openEntry');
      expect(String(message)).toContain('renamedParameter');
    });

    it('does not warn when every action and parameter matches', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      withActionOptions(journalVessel, { openEntry: { title: ['x'] } });

      expect(warn).not.toHaveBeenCalled();
    });

    it('does not warn for a matched action/parameter with an empty option list', () => {
      // Empty is the documented "no options yet" state (see the
      // omits-the-enum-key test above), not a stale key — it must not be
      // flagged as one.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      withActionOptions(journalVessel, { openEntry: { title: [] } });

      expect(warn).not.toHaveBeenCalled();
    });
  });
});
