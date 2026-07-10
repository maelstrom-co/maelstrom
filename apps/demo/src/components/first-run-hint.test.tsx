// @vitest-environment happy-dom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createMockConnector } from '../lib/__tests__/mock-connector';
import { FIRST_RUN_EXAMPLES, FirstRunHint, isFirstRunHintVisible } from './first-run-hint';

const { m } = await import('../lib/maelstrom');

afterEach(() => cleanup());

describe('isFirstRunHintVisible', () => {
  it('is visible with zero instances and nothing processing', () => {
    expect(isFirstRunHintVisible(0, false)).toBe(true);
  });

  it('is hidden once any instance exists', () => {
    expect(isFirstRunHintVisible(1, false)).toBe(false);
  });

  it('is hidden while a request is processing, even with zero instances', () => {
    expect(isFirstRunHintVisible(0, true)).toBe(false);
  });

  it('is hidden when both instances exist and a request is processing', () => {
    expect(isFirstRunHintVisible(2, true)).toBe(false);
  });
});

describe('FirstRunHint', () => {
  it('renders the spoken-style examples on an empty, idle chart', () => {
    const connector = createMockConnector();
    const { getByTestId } = render(
      <m.Provider connector={connector}>
        <FirstRunHint />
      </m.Provider>,
    );

    const hint = getByTestId('first-run-hint');
    for (const example of FIRST_RUN_EXAMPLES) {
      expect(hint.textContent).toContain(example);
    }
  });
});
