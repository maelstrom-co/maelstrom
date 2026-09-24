import { expect, test } from 'bun:test';

import * as publicApi from './index.js';

test('the package entry exposes the planner, prompt builder and prompt sections', () => {
  expect(Object.keys(publicApi).sort()).toEqual(
    [
      'buildPrompt',
      'buildSystemPrompt',
      'buildUserPrompt',
      'llmPlanner',
      'SystemSection',
      'UserSection',
    ].sort(),
  );
});
