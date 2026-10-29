import { expect, test } from 'bun:test';
import {
  AGENT_WIRE_VERSION,
  type AgentUtteranceInput,
  MessageId,
} from '@maelstrom-co/protocol';
import { makeTilingRequest } from '../__test-helpers__/fixtures.js';
import {
  createInputAdmission,
  maxPendingInputs,
  maxRememberedInputIds,
} from './input-admission.js';

const utterance = (inputId: string): AgentUtteranceInput => ({
  type: 'utterance',
  version: AGENT_WIRE_VERSION,
  inputId: MessageId(inputId),
  text: 'Keep my calendar visible',
  source: 'text',
  chart: makeTilingRequest(),
});

const acknowledgement = {
  type: 'ui_applied',
  version: AGENT_WIRE_VERSION,
  changeId: 'change-1',
  chart: makeTilingRequest(),
  actionOutcomes: [],
};

test('an utterance is admitted once and its repeat is ignored', () => {
  const admission = createInputAdmission();
  expect(admission.admit(utterance('input-1'), 0)).toEqual({
    kind: 'utterance',
    input: utterance('input-1'),
  });
  expect(admission.admit(utterance('input-1'), 0)).toEqual({
    kind: 'ignored',
  });
});

test('an acknowledgement is decoded without being remembered or counted against capacity', () => {
  const admission = createInputAdmission();
  expect(admission.admit(acknowledgement, maxPendingInputs)).toMatchObject({
    kind: 'acknowledgement',
    input: { type: 'ui_applied', changeId: 'change-1' },
  });
  expect(admission.admit(acknowledgement, maxPendingInputs).kind).toBe(
    'acknowledgement',
  );
});

test('undecodable input is rejected with its input id only when that id is itself valid', () => {
  const admission = createInputAdmission();
  expect(admission.admit({ type: 'unknown', inputId: 'bad-input' }, 0)).toEqual(
    {
      kind: 'rejected',
      event: {
        type: 'error',
        version: AGENT_WIRE_VERSION,
        inputId: MessageId('bad-input'),
        code: 'invalid_input',
        error: 'Invalid Agent Session input.',
      },
    },
  );
  for (const raw of [null, 'text', { type: 'unknown', inputId: 42 }])
    expect(admission.admit(raw, 0)).toStrictEqual({
      kind: 'rejected',
      event: {
        type: 'error',
        version: AGENT_WIRE_VERSION,
        code: 'invalid_input',
        error: 'Invalid Agent Session input.',
      },
    });
});

test('a full queue rejects an utterance without remembering it, so it can be sent again', () => {
  const admission = createInputAdmission();
  expect(
    admission.admit(utterance('input-33'), maxPendingInputs),
  ).toMatchObject({
    kind: 'rejected',
    event: {
      inputId: 'input-33',
      code: 'queue_full',
      error: 'The connection already has 32 pending inputs.',
    },
  });
  expect(
    admission.admit(utterance('input-33'), maxPendingInputs - 1).kind,
  ).toBe('utterance');
});

test('the input-id bound rejects new utterances but never forgets admitted ones', () => {
  const admission = createInputAdmission();
  for (let index = 0; index < maxRememberedInputIds - 1; index++)
    admission.admit(utterance(`remember-${index}`), 0);
  expect(admission.admit(utterance('last'), maxPendingInputs).kind).toBe(
    'rejected',
  );
  expect(admission.admit(utterance('last'), 0).kind).toBe('utterance');
  expect(admission.admit(utterance('over'), 0)).toMatchObject({
    kind: 'rejected',
    event: {
      inputId: 'over',
      code: 'session_capacity',
      error: 'Open a new connection before sending more inputs.',
    },
  });
  expect(admission.admit(utterance('remember-0'), maxPendingInputs)).toEqual({
    kind: 'ignored',
  });
  expect(admission.admit(utterance('over'), maxPendingInputs)).toMatchObject({
    kind: 'rejected',
    event: { code: 'queue_full' },
  });
});

test('forgetting releases every remembered input id', () => {
  const admission = createInputAdmission();
  admission.admit(utterance('input-1'), 0);
  admission.forget();
  expect(admission.admit(utterance('input-1'), 0).kind).toBe('utterance');
});
