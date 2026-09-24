import { expect, test } from 'bun:test';

import * as testingApi from './_testing.js';

test('_testing exposes the fixture builders, loggers and stage context planner tests use', () => {
  expect(Object.keys(testingApi).sort()).toEqual(
    [
      'brandTilingResponse',
      'buildGridResponse',
      'makeGridRequest',
      'makeTilingRequest',
      'silentLogger',
      'makePlanningInput',
      'makeStageContext',
      'spyLogger',
    ].sort(),
  );
});
