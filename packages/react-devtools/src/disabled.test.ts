import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { devtools } from './disabled.js';

test('production extension requires no Provider, DOM, or observation hooks', () => {
  let observed = false;
  const result = devtools()({
    useMaelstromContext: () => {
      throw new Error('must not access Provider');
    },
    onOrchestrator: () => {
      observed = true;
      return () => {};
    },
  });
  expect(renderToString(createElement(result.Devtools))).toBe('');
  expect(observed).toBe(false);
});
