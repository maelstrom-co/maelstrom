import { describe, it } from 'bun:test';

import type {
  ActionNames,
  VariantNames,
  VariantPropsUnion,
} from './vessel-inference.js';
import type { TestVessel } from './__tests__/test-vessel.fixture';

describe('VariantNames', () => {
  it('extracts literal union of variant keys', () => {
    const _list: VariantNames<TestVessel> = 'list';
    const _detail: VariantNames<TestVessel> = 'detail';
    void [_list, _detail];
  });

  it('rejects invalid variant names', () => {
    // @ts-expect-error - 'unknown' is not a valid variant name
    const _invalid: VariantNames<TestVessel> = 'unknown';
    void _invalid;
  });
});

describe('VariantPropsUnion', () => {
  it('produces correct discriminated union', () => {
    const _listProps: VariantPropsUnion<TestVessel> = {
      variant: 'list',
      view: 'list',
      pageSize: 10,
    };
    const _detailProps: VariantPropsUnion<TestVessel> = {
      variant: 'detail',
      view: 'detail',
      orderId: '',
    };
    void [_listProps, _detailProps];
  });

  it('supports narrowing via variant discriminant', () => {
    const props: VariantPropsUnion<TestVessel> = {
      variant: 'list',
      view: 'list',
      pageSize: 10,
    };

    if (props.variant === 'list') {
      const _pageSize: number = props.pageSize;
      void _pageSize;
    }
  });
});

describe('ActionNames', () => {
  it('extracts all action names across variants', () => {
    const _select: ActionNames<TestVessel> = 'selectOrder';
    const _refresh: ActionNames<TestVessel> = 'refresh';
    const _close: ActionNames<TestVessel> = 'close';
    void [_select, _refresh, _close];
  });

  it('rejects invalid action names', () => {
    // @ts-expect-error - 'invalidAction' is not a valid action name
    const _invalid: ActionNames<TestVessel> = 'invalidAction';
    void _invalid;
  });
});
