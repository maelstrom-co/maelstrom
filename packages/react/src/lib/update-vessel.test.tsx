import { afterEach, beforeAll, describe, expect, it } from 'bun:test';
import type {
  ChartRequestMessage,
  MaelstromResponse,
  VesselDefinition,
} from '@maelstrom-co/protocol';
import {
  ActionName,
  defineVessel,
  InstanceId,
  ok,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import { act, cleanup, render } from '@testing-library/react';
import { useEffect, useMemo } from 'react';
import { assertDefined } from './__tests__/assert-defined.js';
import { createMockConnector } from './__tests__/mock-connector.js';
import { createMaelstrom } from './create-maelstrom.js';
import type { DynamicVesselHandle } from './dynamic-vessel-types.js';
import { vessel } from './vessel.js';

// Mock ResizeObserver (happy-dom may not implement it) — the no-remount test
// mounts a real <m.Chart>, which only lays tiles out once it has dimensions.
type ResizeObserverCallback = (entries: ResizeObserverEntry[]) => void;
let capturedObservers: Array<{ callback: ResizeObserverCallback }> = [];

beforeAll(() => {
  // @ts-expect-error
  globalThis.ResizeObserver = class MockResizeObserver {
    #callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.#callback = callback;
    }
    observe() {
      capturedObservers.push({ callback: this.#callback });
    }
    disconnect() {
      capturedObservers = capturedObservers.filter(
        (o) => o.callback !== this.#callback,
      );
    }
    unobserve() {}
  };
});

afterEach(() => {
  cleanup();
  capturedObservers = [];
});

function triggerResize(width: number, height: number) {
  const entry = {
    contentRect: {
      width,
      height,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: height,
      right: width,
    },
  } as ResizeObserverEntry;
  for (const observer of capturedObservers) {
    observer.callback([entry]);
  }
}

const journalVessel = defineVessel({
  id: 'journal',
  name: 'Journal',
  description: 'Journal entries',
  defaultVariant: 'list',
  variants: {
    list: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [
        {
          name: 'openEntry',
          description: 'Open an entry by title',
          parameters: [
            { name: 'title', type: 'string', description: 'Entry title' },
          ],
        },
      ],
    },
  },
});

/**
 * Same definition, spelled out in full with the option list the engine should
 * end up seeing. Written literally rather than by spreading indexed access —
 * `actions[0]` is `T | undefined` under noUncheckedIndexedAccess, and
 * spreading that silently drops the required fields.
 */
function journalWithTitles(titles: readonly string[]) {
  return defineVessel({
    id: 'journal',
    name: 'Journal',
    description: 'Journal entries',
    defaultVariant: 'list',
    variants: {
      list: {
        props: {},
        minSize: { width: 1, height: 1 },
        actions: [
          {
            name: 'openEntry',
            description: 'Open an entry by title',
            parameters: [
              {
                name: 'title',
                type: 'string' as const,
                description: 'Entry title',
                enum: [...titles],
              },
            ],
          },
        ],
      },
    },
  });
}

function tilingResponse(msg: ChartRequestMessage): MaelstromResponse {
  const instanceId = InstanceId('journal-1');
  return {
    type: 'maelstrom_response',
    requestId: msg.id,
    userMessage: '',
    rationale: '',
    executionPlan: [],
    layout: {
      type: 'tiling',
      tree: [tilingLeafToken(instanceId)],
      instances: [
        {
          instanceId,
          vesselId: VesselId('journal'),
          variant: VariantName('list'),
        },
      ],
    },
  };
}

describe('m.updateVessel()', () => {
  it('publishes the updated definition to the engine', async () => {
    const entry = vessel(journalVessel, () => null);
    const m = createMaelstrom({ vessels: [entry] });

    const requests: ChartRequestMessage[] = [];
    const connector = createMockConnector({
      process: async (msg) => {
        requests.push(msg);
        return tilingResponse(msg);
      },
    });

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function App() {
      processIntent = m.useMaelstrom().processIntent;
      useEffect(() => {
        m.updateVessel(
          journalWithTitles(['Sprint kickoff', 'Architecture review']),
        );
      }, []);
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      );
    });

    assertDefined(processIntent);
    const submit = processIntent;
    await act(async () => {
      await submit('open sprint kickoff');
    });

    const sent = requests.at(-1);
    assertDefined(sent);
    const published = sent.request.vessels.find((v) => v.id === 'journal');
    assertDefined(published);
    const variant = published.variants[VariantName('list')];
    assertDefined(variant);
    expect(variant.actions[0]?.parameters?.[0]?.enum).toEqual([
      'Sprint kickoff',
      'Architecture review',
    ]);
  });

  it('does not remount the vessel component', async () => {
    // The whole reason this API exists: the demo's map vessel owns a MapLibre
    // WebGL context that a remount destroys, and its options change whenever
    // the underlying data does.
    let mounts = 0;
    const lazyEntry = vessel(
      journalVessel,
      async () => ({
        default: function JournalComponent() {
          useEffect(() => {
            mounts += 1;
          }, []);
          return <div>journal body</div>;
        },
      }),
      () => <div>loading</div>,
    );
    const m = createMaelstrom({ vessels: [lazyEntry] });
    const requests: ChartRequestMessage[] = [];
    const connector = createMockConnector({
      process: async (msg) => {
        requests.push(msg);
        return tilingResponse(msg);
      },
    });

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function App() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <m.Provider connector={connector}>
          <m.Chart />
          <App />
        </m.Provider>,
      ));
    });

    await act(async () => {
      triggerResize(800, 600);
    });
    assertDefined(processIntent);
    const submit = processIntent;
    await act(async () => {
      await submit('show journal');
    });

    expect(container.innerHTML).toContain('journal body');
    expect(mounts).toBe(1);

    await act(async () => {
      m.updateVessel(journalWithTitles(['Sprint kickoff']));
    });

    // Both assertions below are trivially true of an updateVessel that does
    // nothing at all. Submitting another intent and inspecting what actually
    // reaches the engine is what proves the republish took effect, rather
    // than merely not crashing or not remounting.
    await act(async () => {
      await submit('show journal again');
    });
    const sent = requests.at(-1);
    assertDefined(sent);
    const published = sent.request.vessels.find((v) => v.id === 'journal');
    assertDefined(published);
    const variant = published.variants[VariantName('list')];
    assertDefined(variant);
    expect(variant.actions[0]?.parameters?.[0]?.enum).toEqual([
      'Sprint kickoff',
    ]);

    expect(mounts).toBe(1);
    expect(container.innerHTML).toContain('journal body');
  });

  it('throws when the vessel was never registered', async () => {
    const entry = vessel(journalVessel, () => null);
    const m = createMaelstrom({ vessels: [entry] });
    // Id is constrained to VesselIds<T> ('journal' only here), so 'ghost'
    // can't reach m.updateVessel() through its typed signature at all. This
    // cast simulates an untyped JS caller to exercise the runtime
    // not-registered guard below, which still has to run regardless of how
    // a caller got past the type system.
    const updateVesselUnchecked = m.updateVessel as unknown as (
      vessel: VesselDefinition,
    ) => void;

    await act(async () => {
      render(
        <m.Provider connector={createMockConnector()}>
          <div />
        </m.Provider>,
      );
    });

    // Pinning the "[Maelstrom] updateVessel:" prefix, not just "is not
    // registered", is what would catch a wrong caller name in the message —
    // the same class of slip that once shipped unnoticed for `unregister()`.
    expect(() =>
      updateVesselUnchecked({ ...journalVessel, id: 'ghost' }),
    ).toThrow('[Maelstrom] updateVessel: vessel "ghost" is not registered');
  });

  it('throws when the definition fails validation', async () => {
    const entry = vessel(journalVessel, () => null);
    const m = createMaelstrom({ vessels: [entry] });

    await act(async () => {
      render(
        <m.Provider connector={createMockConnector()}>
          <div />
        </m.Provider>,
      );
    });

    // Pinning the "[Maelstrom] updateVessel:" prefix, not just "failed
    // validation", is what would catch a wrong caller name in the message.
    // Pinning the joined zod message too, not just the prefix, is what
    // would catch the guard forwarding the wrong issue or an empty list.
    expect(() =>
      m.updateVessel({ ...journalVessel, defaultVariant: 'nope' }),
    ).toThrow(
      '[Maelstrom] updateVessel: vessel "journal" failed validation: Default variant "nope" does not exist in variants',
    );
  });

  it('returns a variant_dropped conflict naming the instance and leaves the registry unchanged when the republish drops a variant currently rendered on screen', async () => {
    // An instance whose variant the new definition no longer declares
    // would otherwise be left unusable with only a console warning — no
    // error and no recoverable state. Republishing that definition must
    // report a conflict instead, and — since the guards run before
    // mutating the registry — it must not half-apply: the old definition
    // (which still covers the live instance) must remain in force.
    const entry = vessel(journalVessel, () => null);
    const m = createMaelstrom({ vessels: [entry] });
    const requests: ChartRequestMessage[] = [];
    const connector = createMockConnector({
      process: async (msg) => {
        requests.push(msg);
        return tilingResponse(msg);
      },
    });

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function App() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      );
    });

    // Seed a live "journal-1" instance on the "list" variant.
    assertDefined(processIntent);
    await act(async () => {
      await processIntent!('show journal');
    });

    const republishDroppingList = defineVessel({
      id: 'journal',
      name: 'Journal',
      description: 'Journal entries',
      defaultVariant: 'archive',
      variants: {
        archive: { props: {}, minSize: { width: 1, height: 1 }, actions: [] },
      },
    });

    const result = m.updateVessel(republishDroppingList);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Pinning the caller prefix and each interpolated value — not the
      // full sentence — matches the promise that callers branch on `code`,
      // not message text.
      expect(result.conflict.message).toContain('[Maelstrom] updateVessel:');
      expect(result.conflict.message).toContain('"journal-1"');
      expect(result.conflict.message).toContain('"list"');
      expect(result.conflict.message).toContain('"journal"');
    }

    // Not half-applied: a follow-up request still publishes the OLD
    // definition (with "list", the variant the live instance is actually
    // on) — not the rejected "archive"-only replacement.
    await act(async () => {
      await processIntent!('show journal again');
    });
    const sent = requests.at(-1);
    assertDefined(sent);
    const published = sent.request.vessels.find((v) => v.id === 'journal');
    assertDefined(published);
    expect(published.variants[VariantName('list')]).toBeDefined();
    expect(published.variants[VariantName('archive')]).toBeUndefined();
  });

  it('returns a structured conflict with code "variant_dropped" when the republish drops a variant currently rendered on screen', async () => {
    // The dropped-variant condition is documented as ordinary and
    // user-triggerable (see the updateVessel JSDoc), so callers need
    // structured data to branch on — not a message substring this package
    // is free to reword.
    const entry = vessel(journalVessel, () => null);
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async (msg) => tilingResponse(msg),
    });

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function App() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      );
    });

    assertDefined(processIntent);
    await act(async () => {
      await processIntent!('show journal');
    });

    const republishDroppingList = defineVessel({
      id: 'journal',
      name: 'Journal',
      description: 'Journal entries',
      defaultVariant: 'archive',
      variants: {
        archive: { props: {}, minSize: { width: 1, height: 1 }, actions: [] },
      },
    });

    const result = m.updateVessel(republishDroppingList);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.conflict.code).toBe('variant_dropped');
    if (result.conflict.code !== 'variant_dropped') return;
    expect(result.conflict.vesselId).toBe(VesselId('journal'));
    expect(result.conflict.instanceId).toBe(InstanceId('journal-1'));
    expect(result.conflict.variant).toBe(VariantName('list'));
  });

  it('returns an action_dropped conflict naming the instance, variant, and action when the republish drops an action a live instance still needs', async () => {
    // The pre-mutation guard used to check variants but not actions, so a
    // republish that drops an action from a live instance's current variant
    // used to pass. The mounted component keeps rendering the old button;
    // invoking it silently misses and warns — the same dead-tile class the
    // variant guard exists to prevent, just one level deeper.
    const entry = vessel(journalVessel, () => null);
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async (msg) => tilingResponse(msg),
    });

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function App() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      );
    });

    // Seed a live "journal-1" instance on the "list" variant.
    assertDefined(processIntent);
    await act(async () => {
      await processIntent!('show journal');
    });

    const republishDroppingAction = defineVessel({
      id: 'journal',
      name: 'Journal',
      description: 'Journal entries',
      defaultVariant: 'list',
      variants: {
        list: { props: {}, minSize: { width: 1, height: 1 }, actions: [] },
      },
    });

    const result = m.updateVessel(republishDroppingAction);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Pinning the caller prefix and each interpolated value — not the
      // full sentence — matches the promise that callers branch on `code`,
      // not message text.
      expect(result.conflict.message).toContain('[Maelstrom] updateVessel:');
      expect(result.conflict.message).toContain('"journal-1"');
      expect(result.conflict.message).toContain('"list"');
      expect(result.conflict.message).toContain('"journal"');
      expect(result.conflict.message).toContain('"openEntry"');
    }
  });

  it('does not half-apply an action_dropped republish: a follow-up request still publishes the OLD definition', async () => {
    // Mirrors the variant_dropped "not half-applied" coverage above — the
    // action check must also run before the commit, so a rejected republish
    // never leaves the old action half-replaced by the new, action-less
    // definition.
    const entry = vessel(journalVessel, () => null);
    const m = createMaelstrom({ vessels: [entry] });
    const requests: ChartRequestMessage[] = [];
    const connector = createMockConnector({
      process: async (msg) => {
        requests.push(msg);
        return tilingResponse(msg);
      },
    });

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function App() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      );
    });

    // Seed a live "journal-1" instance on the "list" variant.
    assertDefined(processIntent);
    await act(async () => {
      await processIntent!('show journal');
    });

    const republishDroppingAction = defineVessel({
      id: 'journal',
      name: 'Journal',
      description: 'Journal entries',
      defaultVariant: 'list',
      variants: {
        list: { props: {}, minSize: { width: 1, height: 1 }, actions: [] },
      },
    });

    const result = m.updateVessel(republishDroppingAction);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.conflict.code).toBe('action_dropped');

    // Not half-applied: a follow-up request still publishes the OLD
    // definition (with "openEntry" still declared) — not the rejected
    // action-less replacement.
    await act(async () => {
      await processIntent!('show journal again');
    });
    const sent = requests.at(-1);
    assertDefined(sent);
    const published = sent.request.vessels.find((v) => v.id === 'journal');
    assertDefined(published);
    const variant = published.variants[VariantName('list')];
    assertDefined(variant);
    expect(variant.actions.map((a) => a.name)).toContain(
      ActionName('openEntry'),
    );
  });

  it('returns a structured conflict with code "action_dropped" when the republish drops an action a live instance still needs', async () => {
    const entry = vessel(journalVessel, () => null);
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async (msg) => tilingResponse(msg),
    });

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function App() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      );
    });

    assertDefined(processIntent);
    await act(async () => {
      await processIntent!('show journal');
    });

    const republishDroppingAction = defineVessel({
      id: 'journal',
      name: 'Journal',
      description: 'Journal entries',
      defaultVariant: 'list',
      variants: {
        list: { props: {}, minSize: { width: 1, height: 1 }, actions: [] },
      },
    });

    const result = m.updateVessel(republishDroppingAction);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.conflict.code).toBe('action_dropped');
    if (result.conflict.code !== 'action_dropped') return;
    expect(result.conflict.vesselId).toBe(VesselId('journal'));
    expect(result.conflict.instanceId).toBe(InstanceId('journal-1'));
    expect(result.conflict.variant).toBe(VariantName('list'));
    expect(result.conflict.missingActionNames).toEqual([
      ActionName('openEntry'),
    ]);
  });

  it('pluralizes "action" and separates each dropped name when the republish drops more than one', async () => {
    // The fixture vessel used elsewhere in this file only ever has one
    // action, so it can never exercise the plural branch or the "', '"
    // join separator between two dropped names.
    const journalWithTwoActions = defineVessel({
      id: 'journal',
      name: 'Journal',
      description: 'Journal entries',
      defaultVariant: 'list',
      variants: {
        list: {
          props: {},
          minSize: { width: 1, height: 1 },
          actions: [
            {
              name: 'openEntry',
              description: 'Open an entry by title',
              parameters: [
                { name: 'title', type: 'string', description: 'Entry title' },
              ],
            },
            {
              name: 'deleteEntry',
              description: 'Delete an entry by title',
              parameters: [
                { name: 'title', type: 'string', description: 'Entry title' },
              ],
            },
          ],
        },
      },
    });
    const entry = vessel(journalWithTwoActions, () => null);
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async (msg) => tilingResponse(msg),
    });

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function App() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      );
    });

    // Seed a live "journal-1" instance on the "list" variant.
    assertDefined(processIntent);
    await act(async () => {
      await processIntent!('show journal');
    });

    const republishDroppingBothActions = defineVessel({
      id: 'journal',
      name: 'Journal',
      description: 'Journal entries',
      defaultVariant: 'list',
      variants: {
        list: { props: {}, minSize: { width: 1, height: 1 }, actions: [] },
      },
    });

    const result = m.updateVessel(republishDroppingBothActions);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Pinning the caller prefix and the interpolated instance/variant/vessel
    // values loosely, but pinning the plural "actions" + join-separator
    // rendering exactly — that plural/join formatting is what this test
    // exists to cover, unlike the boilerplate around it.
    expect(result.conflict.message).toContain('[Maelstrom] updateVessel:');
    expect(result.conflict.message).toContain('"journal-1"');
    expect(result.conflict.message).toContain('"list"');
    expect(result.conflict.message).toContain('"journal"');
    expect(result.conflict.message).toContain(
      'declares actions "openEntry", "deleteEntry"',
    );
    if (result.conflict.code === 'action_dropped') {
      expect(result.conflict.missingActionNames).toEqual([
        ActionName('openEntry'),
        ActionName('deleteEntry'),
      ]);
    }
  });

  it('names the second instance when a two-instance republish drops only the variant the second instance is on', async () => {
    // Earlier coverage only ever seeded a single live instance, so the
    // conflict-scan loop never had to keep checking past the first one.
    const journalWithDetail = defineVessel({
      id: 'journal',
      name: 'Journal',
      description: 'Journal entries',
      defaultVariant: 'list',
      variants: {
        list: { props: {}, minSize: { width: 1, height: 1 }, actions: [] },
        detail: { props: {}, minSize: { width: 1, height: 1 }, actions: [] },
      },
    });
    const entry = vessel(journalWithDetail, () => null);
    const m = createMaelstrom({ vessels: [entry] });
    const listInstance = InstanceId('journal-1');
    const detailInstance = InstanceId('journal-2');
    const connector = createMockConnector({
      process: async (msg) => ({
        type: 'maelstrom_response',
        requestId: msg.id,
        userMessage: '',
        rationale: '',
        executionPlan: [],
        layout: {
          type: 'tiling',
          tree: [
            tilingLeafToken(listInstance),
            tilingLeafToken(detailInstance),
          ],
          instances: [
            {
              instanceId: listInstance,
              vesselId: VesselId('journal'),
              variant: VariantName('list'),
            },
            {
              instanceId: detailInstance,
              vesselId: VesselId('journal'),
              variant: VariantName('detail'),
            },
          ],
        },
      }),
    });

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function App() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      );
    });

    assertDefined(processIntent);
    await act(async () => {
      await processIntent!('show both');
    });

    const republishDroppingDetail = defineVessel({
      id: 'journal',
      name: 'Journal',
      description: 'Journal entries',
      defaultVariant: 'list',
      variants: {
        list: { props: {}, minSize: { width: 1, height: 1 }, actions: [] },
      },
    });

    const result = m.updateVessel(republishDroppingDetail);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Pinning the caller prefix and each interpolated value — not the
      // full sentence — matches the promise that callers branch on `code`,
      // not message text.
      expect(result.conflict.message).toContain('[Maelstrom] updateVessel:');
      expect(result.conflict.message).toContain('"journal-2"');
      expect(result.conflict.message).toContain('"detail"');
      expect(result.conflict.message).toContain('"journal"');
    }
  });

  it('does not scan instances belonging to a different vessel, and still republishes', async () => {
    // The conflict scan walks every live instance in the command-processor
    // store, not just ones for the vessel being republished. "other-1" sits
    // on a variant ("main") that journal's new definition never declares —
    // if the vessel-id skip were missing or compared the wrong field, this
    // republish would incorrectly report "other-1" as stranded by a
    // definition that was never meant to cover it.
    const otherVessel = defineVessel({
      id: 'other',
      name: 'Other',
      description: 'A vessel unrelated to journal',
      defaultVariant: 'main',
      variants: {
        main: { props: {}, minSize: { width: 1, height: 1 }, actions: [] },
      },
    });
    const journalEntry = vessel(journalVessel, () => null);
    const otherEntry = vessel(otherVessel, () => null);
    const m = createMaelstrom({ vessels: [journalEntry, otherEntry] });

    const requests: ChartRequestMessage[] = [];
    const journalInstance = InstanceId('journal-1');
    const otherInstance = InstanceId('other-1');
    const connector = createMockConnector({
      process: async (msg) => {
        requests.push(msg);
        return {
          type: 'maelstrom_response',
          requestId: msg.id,
          userMessage: '',
          rationale: '',
          executionPlan: [],
          layout: {
            type: 'tiling',
            tree: [
              tilingLeafToken(journalInstance),
              tilingLeafToken(otherInstance),
            ],
            instances: [
              {
                instanceId: journalInstance,
                vesselId: VesselId('journal'),
                variant: VariantName('list'),
              },
              {
                instanceId: otherInstance,
                vesselId: VesselId('other'),
                variant: VariantName('main'),
              },
            ],
          },
        };
      },
    });

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function App() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      );
    });

    assertDefined(processIntent);
    const submit = processIntent;
    await act(async () => {
      await submit('show both');
    });

    await act(async () => {
      expect(m.updateVessel(journalWithTitles(['Sprint kickoff']))).toEqual({
        ok: true,
      });
    });

    // Asserting the republished enum reached the mock connector's request,
    // not merely that updateVessel didn't throw, is what proves the
    // republish actually took effect rather than being silently skipped.
    await act(async () => {
      await submit('show both again');
    });
    const sent = requests.at(-1);
    assertDefined(sent);
    const published = sent.request.vessels.find((v) => v.id === 'journal');
    assertDefined(published);
    const variant = published.variants[VariantName('list')];
    assertDefined(variant);
    expect(variant.actions[0]?.parameters?.[0]?.enum).toEqual([
      'Sprint kickoff',
    ]);
  });

  it('throws the documented validation error, not a TypeError, when a live instance exists and the new definition has no variants', async () => {
    // The guard used to run `Object.hasOwn(vessel.variants, ...)` before
    // validating the input. With no live instance for the vessel, an
    // invalid `variants` fell straight through to the documented "failed
    // validation" error below. But with a live instance, the guard loop
    // dereferenced `vessel.variants` first and threw a raw TypeError
    // instead — so error handling written against the documented message
    // broke exactly when a tile for that vessel was on screen.
    const entry = vessel(journalVessel, () => null);
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async (msg) => tilingResponse(msg),
    });

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function App() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      );
    });

    // Seed a live "journal-1" instance so the guard loop actually runs.
    assertDefined(processIntent);
    await act(async () => {
      await processIntent!('show journal');
    });

    const invalidDefinition = {
      ...journalVessel,
      variants: undefined,
    } as unknown as VesselDefinition;
    // Id is constrained to VesselIds<T>, so a definition typed as a bare
    // VesselDefinition (the deliberate malformation above) can no longer
    // reach m.updateVessel() through its typed signature. This cast
    // simulates the untyped JS caller this test's malformed input is
    // meant to represent.
    const updateVesselUnchecked = m.updateVessel as unknown as (
      vessel: VesselDefinition,
    ) => void;

    expect(() => updateVesselUnchecked(invalidDefinition)).toThrow(
      '[Maelstrom] updateVessel: vessel "journal" failed validation:',
    );

    // Symmetry check: the identical malformed definition, with no live
    // instance for the vessel, must produce the same message.
    const noInstanceEntry = vessel(journalVessel, () => null);
    const mNoInstance = createMaelstrom({ vessels: [noInstanceEntry] });
    const updateVesselUncheckedNoInstance =
      mNoInstance.updateVessel as unknown as (vessel: VesselDefinition) => void;
    await act(async () => {
      render(
        <mNoInstance.Provider connector={createMockConnector()}>
          <div />
        </mNoInstance.Provider>,
      );
    });
    expect(() => updateVesselUncheckedNoInstance(invalidDefinition)).toThrow(
      '[Maelstrom] updateVessel: vessel "journal" failed validation:',
    );
  });

  it('throws the documented validation error, not a TypeError, when a live instance exists and the new definition is missing the actions array on the live variant', async () => {
    // The guard used to read `vessel.variants[instance.variant]` with `?.`
    // but then chain `.actions.map(...)` on the result unguarded. An
    // untyped/cast caller whose variant object has no `actions` key made
    // that lookup truthy but `.actions` undefined, throwing a raw TypeError
    // — but only when a live instance existed on that variant. Without a
    // live instance the same malformed input fell straight through to
    // validation and produced the documented "failed validation" message.
    // Both paths must produce that same message: that symmetry, not merely
    // "does not throw TypeError", is the property under test.
    const entry = vessel(journalVessel, () => null);
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async (msg) => tilingResponse(msg),
    });

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function App() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      );
    });

    // Seed a live "journal-1" instance on the "list" variant.
    assertDefined(processIntent);
    await act(async () => {
      await processIntent!('show journal');
    });

    const invalidDefinition = {
      ...journalVessel,
      variants: {
        list: { props: {}, minSize: { width: 1, height: 1 } },
      },
    } as unknown as VesselDefinition;
    const updateVesselUnchecked = m.updateVessel as unknown as (
      vessel: VesselDefinition,
    ) => void;

    expect(() => updateVesselUnchecked(invalidDefinition)).toThrow(
      '[Maelstrom] updateVessel: vessel "journal" failed validation:',
    );

    // Symmetry check: the identical malformed definition, with no live
    // instance for the vessel, must produce the same message.
    const noInstanceEntry = vessel(journalVessel, () => null);
    const mNoInstance = createMaelstrom({ vessels: [noInstanceEntry] });
    const updateVesselUncheckedNoInstance =
      mNoInstance.updateVessel as unknown as (vessel: VesselDefinition) => void;
    await act(async () => {
      render(
        <mNoInstance.Provider connector={createMockConnector()}>
          <div />
        </mNoInstance.Provider>,
      );
    });
    expect(() => updateVesselUncheckedNoInstance(invalidDefinition)).toThrow(
      '[Maelstrom] updateVessel: vessel "journal" failed validation:',
    );
  });

  it('throws the documented validation error, not a returned variant_dropped conflict, when a live instance exists and the new definition has an empty variants object', async () => {
    // `variants: {}` is truthy, so a guard that only fell through to
    // validation on a falsy `variants` treated this as conflict-scan input
    // instead: `Object.hasOwn({}, instance.variant)` is false, so it used to
    // report the recoverable `variant_dropped` conflict rather than the
    // "failed validation" error the schema actually rejects this shape
    // with (`VesselSchema` requires at least one variant). With no live
    // instance the identical input already reached validation and threw
    // the plain Error. Both paths must agree — that symmetry, not merely
    // "throws something", is the property under test.
    const entry = vessel(journalVessel, () => null);
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async (msg) => tilingResponse(msg),
    });

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function App() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      );
    });

    // Seed a live "journal-1" instance so the conflict scan actually runs.
    assertDefined(processIntent);
    await act(async () => {
      await processIntent!('show journal');
    });

    const invalidDefinition = {
      ...journalVessel,
      variants: {},
    } as unknown as VesselDefinition;
    const updateVesselUnchecked = m.updateVessel as unknown as (
      vessel: VesselDefinition,
    ) => void;

    let thrown: unknown;
    try {
      updateVesselUnchecked(invalidDefinition);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(() => updateVesselUnchecked(invalidDefinition)).toThrow(
      '[Maelstrom] updateVessel: vessel "journal" failed validation: Vessel must have at least one variant',
    );

    // Symmetry check: the identical malformed definition, with no live
    // instance for the vessel, must produce the same message.
    const noInstanceEntry = vessel(journalVessel, () => null);
    const mNoInstance = createMaelstrom({ vessels: [noInstanceEntry] });
    const updateVesselUncheckedNoInstance =
      mNoInstance.updateVessel as unknown as (vessel: VesselDefinition) => void;
    await act(async () => {
      render(
        <mNoInstance.Provider connector={createMockConnector()}>
          <div />
        </mNoInstance.Provider>,
      );
    });
    expect(() => updateVesselUncheckedNoInstance(invalidDefinition)).toThrow(
      '[Maelstrom] updateVessel: vessel "journal" failed validation: Vessel must have at least one variant',
    );
  });

  it('throws when no Provider is mounted', () => {
    const entry = vessel(journalVessel, () => null);
    const m = createMaelstrom({ vessels: [entry] });

    // Pinning the "[Maelstrom] updateVessel()" prefix, not the full trailing
    // sentence, is what would still catch a wrong caller name in the message.
    expect(() => m.updateVessel(journalVessel)).toThrow(
      '[Maelstrom] updateVessel() must be called while a <Provider>',
    );
  });

  it('returns a batch_in_flight conflict instead of committing the republish when a command batch is already queued or in flight', async () => {
    // CommandProcessor applies set_layout/execute_actions through an async
    // queue: dispatching an action flips `store.state.status` to
    // 'processing' synchronously, well before the dispatched work actually
    // settles (the runner's readiness wait only resolves on a later
    // microtask). A conflict scan reading the instance snapshot inside that
    // window could pass even though the in-flight batch is about to land an
    // instance on a variant this republish is dropping — this guard exists
    // to catch exactly that race, so it must fire before the scan ever
    // runs. Without it, this test's republish would go on to scan a
    // now-stale snapshot and (depending on timing) wrongly succeed.
    const entry = vessel(journalVessel, () => null);
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async (msg) => tilingResponse(msg),
    });

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    let props: ReturnType<typeof m.useVessel<'journal'>> | undefined;
    function App() {
      processIntent = m.useMaelstrom().processIntent;
      m.useActions('journal', 'journal-1', {
        openEntry: () => ok(undefined),
      });
      props = m.useVessel('journal', 'journal-1');
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      );
    });

    // Seed a live "journal-1" instance on the "list" variant.
    assertDefined(processIntent);
    await act(async () => {
      await processIntent!('show journal');
    });

    assertDefined(props);
    const propsSnapshot = props;
    let result: ReturnType<typeof m.updateVessel> | undefined;
    act(() => {
      // Fired but not awaited: invokeAction dispatches the execute_actions
      // command synchronously, so CommandProcessor's status is already
      // 'processing' by the time this call returns.
      propsSnapshot.executeAction('openEntry', { title: 'x' });
      result = m.updateVessel(journalWithTitles(['Sprint kickoff']));
    });

    assertDefined(result);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.conflict.code).toBe('batch_in_flight');
    if (result.conflict.code !== 'batch_in_flight') return;
    expect(result.conflict.vesselId).toBe(VesselId('journal'));
    expect(result.conflict.message).toContain('journal');

    // Let the in-flight action settle instead of leaking it past the test.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });
});

describe('handle.update()', () => {
  // m.updateVessel()'s Id is now constrained to VesselIds<T>, so a vessel
  // registered only at runtime via registerVessel() — never part of T —
  // has no way to reach m.updateVessel(), typed or otherwise. Every test
  // here seeds its vessel through m.registerVessel() instead, exercising
  // republishVesselDefinition() through the handle rather than through
  // m.updateVessel() directly.

  it('publishes the updated definition to the engine', async () => {
    const m = createMaelstrom({ vessels: [] });
    const entry = vessel(journalVessel, () => null);

    const requests: ChartRequestMessage[] = [];
    const connector = createMockConnector({
      process: async (msg) => {
        requests.push(msg);
        return tilingResponse(msg);
      },
    });

    let handle: DynamicVesselHandle<typeof journalVessel> | undefined;
    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function App() {
      processIntent = m.useMaelstrom().processIntent;
      handle = useMemo(() => m.registerVessel(entry), []);
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      );
    });

    assertDefined(handle);
    const handleSnapshot = handle;
    act(() => {
      handleSnapshot.update(
        journalWithTitles(['Sprint kickoff', 'Architecture review']),
      );
    });

    assertDefined(processIntent);
    const submit = processIntent;
    await act(async () => {
      await submit('open sprint kickoff');
    });

    // Asserting the enum reached the mock connector's request, not merely
    // that update() didn't throw, is what proves the republish took effect.
    const sent = requests.at(-1);
    assertDefined(sent);
    const published = sent.request.vessels.find((v) => v.id === 'journal');
    assertDefined(published);
    const variant = published.variants[VariantName('list')];
    assertDefined(variant);
    expect(variant.actions[0]?.parameters?.[0]?.enum).toEqual([
      'Sprint kickoff',
      'Architecture review',
    ]);
  });

  it('returns a structured conflict with code "variant_dropped" when the republish drops a variant currently rendered on screen', async () => {
    // Same conflict guard m.updateVessel() enforces — handle.update() must
    // route through the same republishVesselDefinition(), not a
    // hand-rolled copy that could drift out of sync with it.
    const m = createMaelstrom({ vessels: [] });
    const entry = vessel(journalVessel, () => null);
    const connector = createMockConnector({
      process: async (msg) => tilingResponse(msg),
    });

    let handle: DynamicVesselHandle<typeof journalVessel> | undefined;
    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function App() {
      processIntent = m.useMaelstrom().processIntent;
      handle = useMemo(() => m.registerVessel(entry), []);
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      );
    });

    // Seed a live "journal-1" instance on the "list" variant.
    assertDefined(processIntent);
    await act(async () => {
      await processIntent!('show journal');
    });

    const republishDroppingList = defineVessel({
      id: 'journal',
      name: 'Journal',
      description: 'Journal entries',
      defaultVariant: 'archive',
      variants: {
        archive: { props: {}, minSize: { width: 1, height: 1 }, actions: [] },
      },
    });

    assertDefined(handle);
    const handleSnapshot = handle;
    const result = handleSnapshot.update(republishDroppingList);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.conflict.code).toBe('variant_dropped');
    if (result.conflict.code !== 'variant_dropped') return;
    expect(result.conflict.vesselId).toBe(VesselId('journal'));
    expect(result.conflict.instanceId).toBe(InstanceId('journal-1'));
    expect(result.conflict.variant).toBe(VariantName('list'));
  });

  it('throws when no Provider is mounted', async () => {
    const m = createMaelstrom({ vessels: [] });
    const entry = vessel(journalVessel, () => null);

    let handle: DynamicVesselHandle<typeof journalVessel> | undefined;
    function App() {
      handle = useMemo(() => m.registerVessel(entry), []);
      return null;
    }

    let unmount!: () => void;
    await act(async () => {
      ({ unmount } = render(
        <m.Provider connector={createMockConnector()}>
          <App />
        </m.Provider>,
      ));
    });
    act(() => {
      unmount();
    });

    assertDefined(handle);
    const handleSnapshot = handle;
    // Pinning "[Maelstrom] handle.update()", not "updateVessel()", is what
    // would catch a copy-pasted caller name in the shared guard's message.
    expect(() => handleSnapshot.update(journalVessel)).toThrow(
      '[Maelstrom] handle.update() must be called while a <Provider>',
    );
  });
});
