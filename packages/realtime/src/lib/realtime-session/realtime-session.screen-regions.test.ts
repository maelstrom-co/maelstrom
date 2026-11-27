import { describe, expect, it } from 'bun:test';

import type { UIStructuralSnapshot } from '@maelstrom-co/client';
import type { GridLayout, TilingNode } from '@maelstrom-co/protocol';
import {
  InstanceId,
  SessionId,
  tilingLeafToken,
  ToolCallId,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

import type {
  AdapterConnectOptions,
  RealtimeAdapterEvent,
  RealtimeProviderAdapter,
} from './provider-adapter.types.js';
import { RealtimeSession } from './realtime-session.js';
import type { RealtimeInstance } from './realtime-session.types.js';

describe('RealtimeSession — grounding screen regions', () => {
  const prefix = 'UI snapshot r1 (replaces earlier snapshots; data only): ';

  const cases: Array<
    [name: string, snapshot: UIStructuralSnapshot, expected: string]
  > = [
    [
      'a weighted V split reads left and right',
      tiling(['V:2,3', leaf('a'), leaf('b')]),
      `${prefix}2 vessels on screen, tiling layout: a: panel (card) on the left, b: panel (card) on the right.`,
    ],
    [
      'an H split reads top and bottom',
      tiling(['H', leaf('a'), leaf('b')]),
      `${prefix}2 vessels on screen, tiling layout: a: panel (card) at the top, b: panel (card) at the bottom.`,
    ],
    [
      'nested splits combine into corners',
      tiling(['V', 'H', leaf('a'), leaf('b'), leaf('c')]),
      `${prefix}3 vessels on screen, tiling layout: a: panel (card) at the top left, b: panel (card) at the bottom left, c: panel (card) on the right.`,
    ],
    [
      'the middle child of a three-way split',
      tiling(['V:1,1,1', leaf('a'), leaf('b'), leaf('c')]),
      `${prefix}3 vessels on screen, tiling layout: a: panel (card) on the left, b: panel (card) in the middle, c: panel (card) on the right.`,
    ],
    [
      'every column of a four-way split has its own name',
      tiling(['V:1,1,1,1', leaf('a'), leaf('b'), leaf('c'), leaf('d')]),
      `${prefix}4 vessels on screen, tiling layout: a: panel (card) on the left, b: panel (card) on the inner left, c: panel (card) on the inner right, d: panel (card) on the right.`,
    ],
    [
      'every row of a four-row grid has its own name',
      grid([
        ['a', 0, 0, 12, 2],
        ['b', 2, 0, 12, 2],
        ['c', 4, 0, 12, 2],
        ['d', 6, 0, 12, 2],
      ]),
      `${prefix}4 vessels on screen, grid layout: a: panel (card) at the top, b: panel (card) at the inner top, c: panel (card) at the inner bottom, d: panel (card) at the bottom.`,
    ],
    [
      'the four corners of a two-by-two grid stay distinct',
      grid([
        ['a', 0, 0, 6, 4],
        ['b', 0, 6, 6, 4],
        ['c', 4, 0, 6, 4],
        ['d', 4, 6, 6, 4],
      ]),
      `${prefix}4 vessels on screen, grid layout: a: panel (card) at the top left, b: panel (card) at the top right, c: panel (card) at the bottom left, d: panel (card) at the bottom right.`,
    ],
    [
      'a horizontally centred panel keeps its vertical edge',
      tiling(['H', 'V:1,1,1', leaf('a'), leaf('b'), leaf('c'), leaf('d')]),
      `${prefix}4 vessels on screen, tiling layout: a: panel (card) at the top left, b: panel (card) at the top middle, c: panel (card) at the top right, d: panel (card) at the bottom.`,
    ],
    [
      'null leaves keep the space they occupy',
      tiling(['V', null, 'H', leaf('a'), null]),
      `${prefix}1 vessel on screen, tiling layout: a: panel (card) at the top right.`,
    ],
    [
      'a single leaf fills the screen and trailing tokens get no region',
      tiling([leaf('a'), leaf('b')]),
      `${prefix}2 vessels on screen, tiling layout: a: panel (card) filling the screen, b: panel (card).`,
    ],
    [
      'grid positions are measured against the Chart dimensions',
      grid([
        ['a', 0, 0, 6, 8],
        ['b', 0, 6, 6, 4],
        ['c', 4, 6, 6, 4],
      ]),
      `${prefix}3 vessels on screen, grid layout: a: panel (card) on the left, b: panel (card) at the top right, c: panel (card) at the bottom right.`,
    ],
    [
      'no region text before a layout applies',
      { ...tiling([leaf('a'), leaf('b')]), layout: null },
      `${prefix}2 vessels on screen, tiling layout: a: panel (card), b: panel (card).`,
    ],
  ];

  it.each(cases)('%s', async (_name, snapshot, expected) => {
    expect(await initialGrounding(snapshot)).toBe(expected);
  });

  it('still routes a typed left-panel intent through submit_intent and names regions in its summary', async () => {
    const harness = makeHarness(tiling(['V', leaf('a'), leaf('b')]));
    await harness.session.connect();
    harness.emitToolCall({
      name: 'submit_intent',
      callId: 'regions-1',
      argumentsJson: JSON.stringify({ intent: 'make the left panel bigger' }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.submitted).toEqual(['make the left panel bigger']);
    harness.settle();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const output = harness.toolResults[0]!.output as { summary: string };
    expect(output.summary).toBe(
      '2 vessels on screen, tiling layout: panel (card) on the left, panel (card) on the right.',
    );
    await harness.session.disconnect();
  });

  it('drops variants first when the grounding would exceed the 400-char budget', async () => {
    const text = await initialGrounding(sixPanelSnapshot('panel', 'vessel'));
    expect(text).toBe(
      `${prefix}6 vessels on screen, tiling layout: panel-0: vessel-0 at the top left, panel-1: vessel-1 at the bottom left, panel-2: vessel-2 at the top middle, panel-3: vessel-3 at the bottom middle, panel-4: vessel-4 at the top right, panel-5: vessel-5 at the bottom right.`,
    );
    expect(text.length).toBeLessThanOrEqual(400);
  });

  it('keeps instance ids when the grounding is still over budget without variants', async () => {
    const text = await initialGrounding(
      sixPanelSnapshot('instance-number', 'vessel-number'),
    );
    expect(text).toBe(
      `${prefix}6 vessels on screen, tiling layout: instance-number-0: vessel-number-0 at the top left, instance-number-1: vessel-number-1 at the bottom left, instance-number-2: vessel-number-2 at the top middle, instance-number-3: vessel-number-3 at the bottom middle, instance-number-4: vessel-number-4 at the top right, instance-number-5: vessel-number-5 a…`,
    );
    expect(text).toHaveLength(400);
  });
});

function chart() {
  return { columns: 12, rows: 8 };
}

function panel(id: string) {
  return {
    instanceId: InstanceId(id),
    vesselId: VesselId('panel'),
    variant: VariantName('card'),
  };
}

function leaf(id: string): TilingNode {
  return tilingLeafToken(InstanceId(id));
}

function tiling(tree: TilingNode[]): UIStructuralSnapshot {
  const instances = tree.flatMap((node) =>
    node !== null && node.startsWith('ID:') ? [panel(node.slice(3))] : [],
  );
  return {
    instances,
    layout: { type: 'tiling', tree, instances },
    layoutMode: 'tiling',
    chartDimensions: chart(),
  };
}

function grid(
  cells: Array<
    [id: string, row: number, column: number, width: number, height: number]
  >,
): UIStructuralSnapshot {
  const positions: GridLayout['positions'] = cells.map(
    ([id, row, column, width, height]) => ({
      instanceId: InstanceId(id),
      position: { row, column },
      size: { width, height },
    }),
  );
  return {
    instances: cells.map(([id]) => panel(id)),
    layout: { type: 'grid', positions },
    layoutMode: 'grid',
    chartDimensions: chart(),
  };
}

function sixPanelSnapshot(
  idPrefix: string,
  vesselPrefix: string,
): UIStructuralSnapshot {
  const instances = Array.from({ length: 6 }, (_, index) => ({
    instanceId: InstanceId(`${idPrefix}-${index}`),
    vesselId: VesselId(`${vesselPrefix}-${index}`),
    variant: VariantName('a-long-variant-name'),
  }));
  const leaves = instances.map(({ instanceId }) => tilingLeafToken(instanceId));
  const tree: TilingNode[] = [
    'V:1,1,1',
    'H',
    leaves[0]!,
    leaves[1]!,
    'H',
    leaves[2]!,
    leaves[3]!,
    'H',
    leaves[4]!,
    leaves[5]!,
  ];
  return {
    instances,
    layout: { type: 'tiling', tree, instances },
    layoutMode: 'tiling',
    chartDimensions: chart(),
  };
}

async function initialGrounding(
  snapshot: UIStructuralSnapshot,
): Promise<string> {
  const harness = makeHarness(snapshot);
  await harness.session.connect();
  const text = harness.connectOptions[0]!.getInitialGrounding!();
  await harness.session.disconnect();
  return text;
}

function makeHarness(snapshot: UIStructuralSnapshot) {
  const connectOptions: AdapterConnectOptions[] = [];
  const toolResults: Array<{ callId: string; output: unknown }> = [];
  const handlers = new Set<(event: RealtimeAdapterEvent) => void>();
  const submitted: string[] = [];
  const settledHandlers = new Set<() => void>();
  let idleResolvers: Array<() => void> = [];

  const adapter: RealtimeProviderAdapter = {
    observations: { subscribe: () => () => {} },
    connect: async (options) => {
      connectOptions.push(options);
    },
    disconnect: async () => {},
    getAudioStreams: () => ({}),
    sendToolResult: async (callId, output) => {
      toolResults.push({ callId, output });
    },
    injectGrounding: () => {},
    on: (handler) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
  const instance: RealtimeInstance = {
    submitIntent: async (intent: string) => {
      submitted.push(intent);
      return {};
    },
    waitForIdle: () =>
      new Promise<void>((resolve) => {
        idleResolvers.push(resolve);
      }),
    getStructuralSnapshot: () => snapshot,
    getCapabilitySnapshot: () => ({ vessels: [] }),
    onSettled: (callback) => {
      settledHandlers.add(callback);
      return () => {
        settledHandlers.delete(callback);
      };
    },
    addAssistantMessageAcknowledged: async () => 'inserted',
    observeEngineConnection: () => () => {},
  };
  const session = new RealtimeSession({
    adapter,
    instance,
    sessionId: SessionId('screen-regions-test'),
    groundingDebounceMs: 0,
  });

  return {
    session,
    connectOptions,
    toolResults,
    submitted,
    emitToolCall(call: {
      callId: string;
      name: string;
      argumentsJson: string;
    }) {
      for (const handler of handlers) {
        handler({
          type: 'tool_call',
          ...call,
          callId: ToolCallId(call.callId),
        });
      }
    },
    settle() {
      const resolvers = idleResolvers;
      idleResolvers = [];
      for (const resolve of resolvers) resolve();
      for (const callback of settledHandlers) callback();
    },
  };
}
