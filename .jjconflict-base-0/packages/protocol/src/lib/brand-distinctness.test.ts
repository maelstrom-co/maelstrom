import { describe, expect, test } from 'bun:test';

import { ActionName } from './action-name.js';
import { InstanceId } from './instance.js';
import { VariantName } from './variant-name.js';
import { VesselId } from './vessel-id.js';

/**
 * Compile-time witness that branded IDs are mutually unassignable.
 * If any of the @ts-expect-error lines stops being an error (i.e. the
 * brand is accidentally widened), tsc fails and this test won't compile.
 */
describe('brand distinctness', () => {
  test('type-level: branded IDs do not cross-assign', () => {
    const inst = InstanceId('a');
    const vess = VesselId('b');
    const vari = VariantName('c');
    const act = ActionName('d');

    // @ts-expect-error InstanceId is not assignable to VesselId
    const _v: VesselId = inst;
    // @ts-expect-error VesselId is not assignable to InstanceId
    const _i: InstanceId = vess;
    // @ts-expect-error InstanceId is not assignable to VariantName
    const _vn: VariantName = inst;
    // @ts-expect-error InstanceId is not assignable to ActionName
    const _an: ActionName = inst;
    // @ts-expect-error VariantName is not assignable to ActionName
    const _an2: ActionName = vari;
    // @ts-expect-error ActionName is not assignable to VariantName
    const _vn2: VariantName = act;
    // @ts-expect-error VesselId is not assignable to VariantName
    const _vn3: VariantName = vess;
    // @ts-expect-error VesselId is not assignable to ActionName
    const _an3: ActionName = vess;

    void [_v, _i, _vn, _an, _an2, _vn2, _vn3, _an3];

    expect(true).toBe(true);
  });
});
