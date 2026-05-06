/**
 * Type tests for ActionRunner
 *
 * Run `nx typecheck @maelstrom-co/client` to verify these tests.
 */

import { describe, it } from 'bun:test';

import { defineVessel, ok, type Result } from '@maelstrom-co/protocol';

import type { ActionResult } from './action-result.js';
import type {
  ActionNames,
  ActionParams,
  ActionRunner,
  VariantNames,
} from './action-runner.types.js';

// ============================================================================
// Test Vessel Definition - realistic object shape
// ============================================================================

const testVessel = defineVessel({
  id: 'test-vessel',
  name: 'Test Vessel',
  description: 'A test vessel',
  defaultVariant: 'list',
  variants: {
    list: {
      props: { view: 'list' },
      minSize: { width: 2, height: 2 },
      actions: [
        {
          name: 'selectOrder',
          description: 'Select order',
          parameters: [
            {
              name: 'orderId',
              type: 'string',
              description: 'Order id',
              required: true,
            },
          ],
        },
        {
          name: 'refresh',
          description: 'Refresh list',
        },
      ],
    },
    detail: {
      props: { view: 'detail' },
      minSize: { width: 2, height: 2 },
      actions: [
        {
          name: 'updateField',
          description: 'Update field',
          parameters: [
            {
              name: 'field',
              type: 'string',
              description: 'Field name',
              required: true,
            },
          ],
        },
        {
          name: 'close',
          description: 'Close detail',
        },
      ],
    },
  },
});

type TestVessel = typeof testVessel;

// ============================================================================
// Compile-time type tests
// These will fail to compile if types are wrong
// ============================================================================

describe('ActionRunner Type Tests', () => {
  it('should extract all action names', () => {
    // This should compile if the type is correct
    const _testNames: ActionNames<TestVessel> = 'selectOrder';
    const _testNames2: ActionNames<TestVessel> = 'refresh';
    const _testNames3: ActionNames<TestVessel> = 'updateField';
    const _testNames4: ActionNames<TestVessel> = 'close';

    void [_testNames, _testNames2, _testNames3, _testNames4];
  });

  it('should reject invalid action names', () => {
    // @ts-expect-error - 'invalidAction' is not a valid action name
    const _invalidAction: ActionNames<TestVessel> = 'invalidAction';
    void _invalidAction;
  });

  it('should allow creating a typed runner', () => {
    const runner: ActionRunner<TestVessel> = {
      selectOrder: async (params) => {
        const _orderId: string = params.orderId;
        void _orderId;
        return ok(undefined);
      },
      refresh: async () => ok(undefined),
      updateField: async (params) => {
        const _field: string = params.field;
        void _field;
        return ok(undefined);
      },
      close: async () => ok(undefined),
    };

    void runner;
  });

  it('should reject runner with invalid action name', () => {
    const _invalidRunner: ActionRunner<TestVessel> = {
      selectOrder: async () => ok(undefined),
      refresh: async () => ok(undefined),
      updateField: async () => ok(undefined),
      close: async () => ok(undefined),
      // @ts-expect-error - 'invalidAction' is not a valid action
      invalidAction: async () => ok(undefined),
    };
    void _invalidRunner;
  });

  it('should infer params for selectOrder', () => {
    const _params: ActionParams<TestVessel, 'selectOrder'> = {
      orderId: 'order-1',
    };

    void _params;
  });

  it('should reject invalid params for selectOrder', () => {
    const _params: ActionParams<TestVessel, 'selectOrder'> = {
      // @ts-expect-error - orderId must be string, not number
      orderId: 123,
    };
    void _params;
  });

  it('should reject missing required params', () => {
    // @ts-expect-error - orderId is required
    const _invalidParams: ActionParams<TestVessel, 'selectOrder'> = {};
    void _invalidParams;
  });

  it('should infer params for updateField', () => {
    const _params: ActionParams<TestVessel, 'updateField'> = {
      field: 'status',
    };

    void _params;
  });

  it('should reject extra params', () => {
    const _invalidParams: ActionParams<TestVessel, 'selectOrder'> = {
      orderId: 'order-1',
      // @ts-expect-error - extraParam is not defined
      extraParam: 'extra',
    };
    void _invalidParams;
  });

  it('should handle actions without params', () => {
    // refresh has no params, so the type should be undefined
    const _params: ActionParams<TestVessel, 'refresh'> = undefined;
    void _params;
  });

  it('should reject params for actions without params', () => {
    // @ts-expect-error - refresh does not accept params
    const _invalidParams: ActionParams<TestVessel, 'refresh'> = {
      someParam: 'value',
    };
    void _invalidParams;
  });

  it('should reject wrong param types', () => {
    const _invalidParams: ActionParams<TestVessel, 'updateField'> = {
      // @ts-expect-error - field must be string, not boolean
      field: true,
    };
    void _invalidParams;
  });
});

describe('VariantNames Type Tests', () => {
  it('should extract all variant keys', () => {
    const _list: VariantNames<TestVessel> = 'list';
    const _detail: VariantNames<TestVessel> = 'detail';
    void [_list, _detail];
  });

  it('should reject unknown variant keys', () => {
    // @ts-expect-error - 'bogus' is not a valid variant
    const _bogus: VariantNames<TestVessel> = 'bogus';
    void _bogus;
  });
});

describe('ActionResult ↔ Result equivalence', () => {
  it('resolves to Result<undefined, Error>', () => {
    type _AssertActionResult = ActionResult extends Result<undefined, Error>
      ? Result<undefined, Error> extends ActionResult
        ? true
        : never
      : never;
    const _check: _AssertActionResult = true;
    void _check;
  });
});
