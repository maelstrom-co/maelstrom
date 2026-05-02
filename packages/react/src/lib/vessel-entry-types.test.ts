import { describe, it } from 'bun:test';
import { defineVessel, type InstanceId } from '@maelstrom-co/protocol';

import type { ExtractActionParams } from '@maelstrom-co/client';

import type { TypedVesselProps, VesselIds, ExtractVesselByIdFromEntries } from './vessel-entry-types.js';
import { vessel } from './vessel.js';
import { testVessel, type TestVessel } from './__tests__/test-vessel.fixture';

describe('TypedVesselProps', () => {
  it('accepts valid action names and params', () => {
    const _props: TypedVesselProps<TestVessel> = {
      instanceId: 'inst-1' as InstanceId,
      variantProps: { variant: 'list', view: 'list', pageSize: 10 },
      executeAction: (...args) => {
        void args;
      },
    };
    _props.executeAction('selectOrder', { orderId: 'ord-1' });
    _props.executeAction('refresh');
    _props.executeAction('close');
    void _props;
  });

  it('rejects unknown params for a parameterized action', () => {
    const props: TypedVesselProps<TestVessel> = {
      instanceId: 'inst-1' as InstanceId,
      variantProps: { variant: 'list', view: 'list', pageSize: 10 },
      executeAction: () => {},
    };
    // @ts-expect-error - 'wrongKey' does not exist in type '{ orderId: string }'
    props.executeAction('selectOrder', { wrongKey: 'ord-1' });
    // @ts-expect-error - excess property 'wrongKey' not allowed alongside valid key
    props.executeAction('selectOrder', { orderId: 'ord-1', wrongKey: '' });
    void props;
  });

  it('rejects invalid action names in executeAction', () => {
    // @ts-expect-error - 'badAction' is not a valid action name
    const _fn: TypedVesselProps<TestVessel>['executeAction'] = (name: 'badAction') => {};
    void _fn;
  });

  it('constrains executeAction name to ActionNames<V>', () => {
    // @ts-expect-error - empty string is not a valid action name
    const _fn1: TypedVesselProps<TestVessel>['executeAction'] = (name: '') => {};
    // @ts-expect-error - arbitrary string is not a valid action name
    const _fn2: TypedVesselProps<TestVessel>['executeAction'] = (name: 'nonExistent') => {};
    void [_fn1, _fn2];
  });

  it('allows actions from all variants', () => {
    type Fn = TypedVesselProps<TestVessel>['executeAction'];
    // Type-level only: verify all action names are assignable to the name param
    const _select: Parameters<Fn>[0] = 'selectOrder';
    const _refresh: Parameters<Fn>[0] = 'refresh';
    const _close: Parameters<Fn>[0] = 'close';
    void [_select, _refresh, _close];
  });

  it('maps action params to concrete types (not unknown)', () => {
    // The TestVessel's selectOrder action has parameter orderId of type 'string'.
    // After the fix, ExtractActionParams should map it to string, not unknown.
    type SelectParams = ExtractActionParams<TestVessel, 'selectOrder'>;
    // If this were unknown, assigning string would pass but the reverse wouldn't
    type _OrderIdIsString = SelectParams extends { orderId: string }
      ? string extends SelectParams['orderId']
        ? true
        : never
      : never;
    const _check: _OrderIdIsString = true;
    void _check;

    // @ts-expect-error - orderId should be string, not number
    const _badParam: SelectParams = { orderId: 123 };
    void _badParam;
  });

  it('rejects parameterized actions called without params', () => {
    const props: TypedVesselProps<TestVessel> = {
      instanceId: 'inst-1' as InstanceId,
      variantProps: { variant: 'list', view: 'list', pageSize: 10 },
      executeAction: () => {},
    };
    // @ts-expect-error - selectOrder requires { orderId: string }
    props.executeAction('selectOrder');
    void props;
  });

  it('rejects spurious params on parameterless actions', () => {
    const props: TypedVesselProps<TestVessel> = {
      instanceId: 'inst-1' as InstanceId,
      variantProps: { variant: 'list', view: 'list', pageSize: 10 },
      executeAction: () => {},
    };
    // @ts-expect-error - refresh takes no params
    props.executeAction('refresh', { extra: true });
    void props;
  });
});

describe('VesselIds', () => {
  it('extracts union of vessel IDs from tuple', () => {
    const entry = vessel(testVessel, () => null);
    type Ids = VesselIds<[typeof entry]>;
    const _id: Ids = 'orders';
    // @ts-expect-error - 'other' is not a valid vessel ID
    const _badId: Ids = 'other';
    void [_id, _badId];
  });
});

const calendarDef = defineVessel({
  id: 'calendar',
  name: 'Calendar',
  description: 'Calendar vessel',
  defaultVariant: 'month',
  variants: {
    month: { props: { view: 'month' as const }, minSize: { width: 2, height: 2 }, actions: [] },
    week: { props: { view: 'week' as const }, minSize: { width: 3, height: 2 }, actions: [] },
  },
});

const weatherDef = defineVessel({
  id: 'weather',
  name: 'Weather',
  description: 'Weather vessel',
  defaultVariant: 'compact',
  variants: {
    compact: { props: { city: '' }, minSize: { width: 1, height: 1 }, actions: [] },
  },
});

const multiEntries = [
  vessel(calendarDef, () => null),
  vessel(weatherDef, () => null),
] as const;

type MultiEntries = typeof multiEntries;

describe('ExtractVesselByIdFromEntries', () => {
  it('extracts the calendar vessel type by id', () => {
    type CalendarVessel = ExtractVesselByIdFromEntries<MultiEntries, 'calendar'>;
    type _HasMonthVariant = CalendarVessel['variants']['month'] extends object ? true : never;
    const _check: _HasMonthVariant = true;
    void _check;
  });

  it('extracts the weather vessel type by id', () => {
    type WeatherVessel = ExtractVesselByIdFromEntries<MultiEntries, 'weather'>;
    type _HasCompactVariant = WeatherVessel['variants']['compact'] extends object ? true : never;
    const _check: _HasCompactVariant = true;
    void _check;
  });

  it('preserves literal variant prop types', () => {
    type CalendarVessel = ExtractVesselByIdFromEntries<MultiEntries, 'calendar'>;
    type MonthView = CalendarVessel['variants']['month']['props']['view'];
    // Must be the literal 'month', not widened string
    type _IsLiteral = MonthView extends 'month' ? ('month' extends MonthView ? true : never) : never;
    const _check: _IsLiteral = true;
    void _check;
  });
});
