/**
 * Type tests for ActionRunner
 *
 * Run `nx typecheck @maelstrom-co/client` to verify these tests.
 */

import { describe, it } from 'bun:test';

import { defineVessel, Success } from '@maelstrom-co/protocol-old';

import type {
  ActionRunner,
  AllVariantActionNames,
  ExtractActionParams,
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
    const _testNames: AllVariantActionNames<TestVessel> = 'selectOrder';
    const _testNames2: AllVariantActionNames<TestVessel> = 'refresh';
    const _testNames3: AllVariantActionNames<TestVessel> = 'updateField';
    const _testNames4: AllVariantActionNames<TestVessel> = 'close';

    void [_testNames, _testNames2, _testNames3, _testNames4];
  });

  it('should reject invalid action names', () => {
    // @ts-expect-error - 'invalidAction' is not a valid action name
    const _invalidAction: AllVariantActionNames<TestVessel> = 'invalidAction';
    void _invalidAction;
  });

  it('should allow creating a typed runner', () => {
    const runner: ActionRunner<TestVessel> = {
      selectOrder: async (params) => {
        const _orderId: string = params.orderId;
        void _orderId;
        return Success();
      },
      refresh: async () => Success(),
      updateField: async (params) => {
        const _field: string = params.field;
        void _field;
        return Success();
      },
      close: async () => Success(),
    };

    void runner;
  });

  it('should reject runner with invalid action name', () => {
    const _invalidRunner: ActionRunner<TestVessel> = {
      selectOrder: async () => Success(),
      refresh: async () => Success(),
      updateField: async () => Success(),
      close: async () => Success(),
      // @ts-expect-error - 'invalidAction' is not a valid action
      invalidAction: async () => Success(),
    };
    void _invalidRunner;
  });

  it('should infer params for selectOrder', () => {
    const _params: ExtractActionParams<TestVessel, 'selectOrder'> = {
      orderId: 'order-1',
    };

    void _params;
  });

  it('should reject invalid params for selectOrder', () => {
    const _params: ExtractActionParams<TestVessel, 'selectOrder'> = {
      // @ts-expect-error - orderId must be string, not number
      orderId: 123,
    };
    void _params;
  });

  it('should reject missing required params', () => {
    // @ts-expect-error - orderId is required
    const _invalidParams: ExtractActionParams<TestVessel, 'selectOrder'> = {};
    void _invalidParams;
  });

  it('should infer params for updateField', () => {
    const _params: ExtractActionParams<TestVessel, 'updateField'> = {
      field: 'status',
    };

    void _params;
  });

  it('should reject extra params', () => {
    const _invalidParams: ExtractActionParams<TestVessel, 'selectOrder'> = {
      orderId: 'order-1',
      // @ts-expect-error - extraParam is not defined
      extraParam: 'extra',
    };
    void _invalidParams;
  });

  it('should handle actions without params', () => {
    // refresh has no params, so the type should be undefined
    const _params: ExtractActionParams<TestVessel, 'refresh'> = undefined;
    void _params;
  });

  it('should reject params for actions without params', () => {
    // @ts-expect-error - refresh does not accept params
    const _invalidParams: ExtractActionParams<TestVessel, 'refresh'> = {
      someParam: 'value',
    };
    void _invalidParams;
  });

  it('should reject wrong param types', () => {
    const _invalidParams: ExtractActionParams<TestVessel, 'updateField'> = {
      // @ts-expect-error - field must be string, not boolean
      field: true,
    };
    void _invalidParams;
  });
});
