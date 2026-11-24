import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MaelstromResponseMessageSchema,
  type TilingLayout,
  tilingLeafInstanceId,
  VesselSchema,
} from '@maelstrom-co/protocol';

import { ordersVessel } from './orders.vessel';

const ENGINE_RESPONSE_PATH = join(import.meta.dirname, 'engine-response.json');

describe('How It Works examples', () => {
  it('declares a Vessel the protocol schema accepts', () => {
    expect(VesselSchema.safeParse(ordersVessel).error?.issues ?? []).toEqual(
      [],
    );
  });

  it('declares no Action field that only one supported SDK version accepts', () => {
    VesselSchema.parse(ordersVessel);
    const actionFields = Object.values(ordersVessel.variants).flatMap(
      (variant) => variant.actions.flatMap((action) => Object.keys(action)),
    );
    expect(actionFields).not.toContain('effect');
    expect(actionFields).not.toContain('idempotent');
  });

  it('shows an engine response the workspace response schema accepts', () => {
    const result =
      MaelstromResponseMessageSchema.shape.response.safeParse(
        readEngineResponse(),
      );
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it('includes a user message string, which every supported SDK version accepts', () => {
    expect(typeof parseEngineResponse().userMessage).toBe('string');
  });

  it('lists every tiling leaf as an instance and every instance as a leaf', () => {
    const layout = tilingLayoutOf(parseEngineResponse());
    expect(layout.instances.length).toBeGreaterThan(0);
    expect(new Set(treeLeaves(layout))).toEqual(
      new Set(layout.instances.map((instance) => instance.instanceId)),
    );
  });

  it('places only instances of the example Vessel', () => {
    const layout = tilingLayoutOf(parseEngineResponse());
    expect(layout.instances.length).toBeGreaterThan(0);
    for (const instance of layout.instances) {
      expect(String(instance.vesselId)).toBe(ordersVessel.id);
    }
  });

  it('plans only declared Actions on listed instances with exactly their required parameters', () => {
    const vessel = VesselSchema.parse(ordersVessel);
    const response = parseEngineResponse();
    const layout = tilingLayoutOf(response);
    expect(response.executionPlan.length).toBeGreaterThan(0);

    for (const entry of response.executionPlan) {
      const instance = layout.instances.find(
        (candidate) => candidate.instanceId === entry.instanceId,
      );
      if (!instance) {
        throw new Error(`No listed instance "${entry.instanceId}"`);
      }
      expect(Object.hasOwn(vessel.variants, instance.variant)).toBe(true);
      const action = vessel.variants[instance.variant]?.actions.find(
        (candidate) => candidate.name === entry.action,
      );
      if (!action) {
        throw new Error(
          `Variant "${instance.variant}" declares no Action "${entry.action}"`,
        );
      }
      const requiredParameterNames = (action.parameters ?? [])
        .filter((parameter) => parameter.required)
        .map((parameter) => parameter.name)
        .sort();
      expect(Object.keys(entry.params ?? {}).sort()).toEqual(
        requiredParameterNames,
      );
    }
    expect(
      response.executionPlan.some(
        (entry) => Object.keys(entry.params ?? {}).length > 0,
      ),
    ).toBe(true);
  });

  it('keeps only the five rendered examples and the app helper beside this test', () => {
    expect(readdirSync(import.meta.dirname).sort()).toEqual(
      [
        'Dashboard.tsx',
        'OrdersVessel.tsx',
        'app.tsx',
        'engine-response.json',
        'examples.test.ts',
        'maelstrom.ts',
        'orders.vessel.ts',
      ].sort(),
    );
  });
});

function readEngineResponse(): unknown {
  return JSON.parse(readFileSync(ENGINE_RESPONSE_PATH, 'utf8'));
}

function parseEngineResponse() {
  return MaelstromResponseMessageSchema.shape.response.parse(
    readEngineResponse(),
  );
}

function tilingLayoutOf(
  response: ReturnType<typeof parseEngineResponse>,
): TilingLayout {
  if (response.layout.type !== 'tiling') {
    throw new Error(`Expected a tiling layout, got "${response.layout.type}"`);
  }
  return response.layout;
}

// Instance IDs referenced as leaves in the tiling tree, without split markers.
function treeLeaves(layout: TilingLayout) {
  return layout.tree
    .map(tilingLeafInstanceId)
    .filter((instanceId) => instanceId !== null);
}
