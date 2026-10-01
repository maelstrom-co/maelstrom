import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selectVoiceBenchmark,
  singleTurnDiagnosticRetries,
} from './benchmark-selection.ts';

test('defaults to the unchanged three-scenario benchmark selection', () => {
  assert.deepEqual(selectVoiceBenchmark({}), {
    singleTurn: false,
    repetitions: 1,
    scenarios: ['only-tasks', 'open-calendar', 'put-it-back'],
    selectedScenario: null,
  });
  assert.equal(selectVoiceBenchmark({ repetitions: '3' }).repetitions, 3);
});

test('single-turn mode selects exactly one scenario and one repetition', () => {
  assert.deepEqual(
    selectVoiceBenchmark({ singleTurn: '1', repetitions: '3' }),
    {
      singleTurn: true,
      repetitions: 1,
      scenarios: ['only-tasks'],
      selectedScenario: 'only-tasks',
    },
  );
});

test('retries the opt-in single-turn diagnostic three times only', () => {
  assert.equal(singleTurnDiagnosticRetries('1'), 3);
  assert.equal(singleTurnDiagnosticRetries(undefined), 0);
  assert.equal(singleTurnDiagnosticRetries(''), 0);
  assert.equal(singleTurnDiagnosticRetries('true'), 0);
});

test('rejects invalid single-turn and repetition values', () => {
  assert.throws(
    () => selectVoiceBenchmark({ singleTurn: 'true' }),
    /SINGLE_TURN/,
  );
  assert.throws(
    () => selectVoiceBenchmark({ repetitions: '0' }),
    /REPETITIONS/,
  );
  assert.throws(
    () => selectVoiceBenchmark({ repetitions: '4' }),
    /REPETITIONS/,
  );
});
