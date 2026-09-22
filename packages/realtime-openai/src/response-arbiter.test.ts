import { expect, test } from 'bun:test';
import { ResponseArbiter } from './response-arbiter.js';

test('defers trigger requests without dropping them or using default history', () => {
  const commands: object[] = [];
  const requests: (string | undefined)[] = [];
  let ready = false;
  const arbiter = new ResponseArbiter({
    send: (command) => commands.push(command),
    error: () => {},
    debug: () => {},
    responseInput: (inputId) => {
      requests.push(inputId);
      return ready ? ['grounding', 'admitted-user'] : undefined;
    },
  });
  arbiter.completed('admitted-user', true);
  arbiter.committed('admitted-user');
  expect(commands).toEqual([]);
  ready = true;
  arbiter.referencesChanged();
  expect(commands).toEqual([
    {
      type: 'response.create',
      response: {
        conversation: 'auto',
        input: [
          { type: 'item_reference', id: 'grounding' },
          { type: 'item_reference', id: 'admitted-user' },
        ],
      },
    },
  ]);
  expect(requests).toEqual(['admitted-user', 'admitted-user']);
  arbiter.referencesChanged();
  expect(commands).toHaveLength(1);
});

test('gates coalesced tool follow-ups and queued turns through the same snapshot seam', () => {
  const commands: object[] = [];
  const sources: (string | undefined)[] = [];
  let references: readonly string[] | undefined;
  const arbiter = new ResponseArbiter({
    send: (command) => commands.push(command),
    error: () => {},
    debug: () => {},
    responseInput: (inputId) => {
      sources.push(inputId);
      return references;
    },
  });
  arbiter.requestToolFollowUp('first');
  arbiter.requestToolFollowUp('second');
  arbiter.committed('third');
  arbiter.completed('third', true);
  expect(commands).toEqual([]);
  references = ['user', 'call', 'acknowledged-output'];
  arbiter.referencesChanged();
  arbiter.responseCreated('follow-up');
  references = undefined;
  arbiter.responseDone('follow-up', false);
  expect(commands).toHaveLength(1);
  references = ['user', 'call', 'acknowledged-output', 'assistant', 'third'];
  arbiter.referencesChanged();
  expect(commands).toHaveLength(2);
  expect(sources.at(-1)).toBe('third');
  expect(sources).toContain('second');
  expect(commands[0]).toEqual({
    type: 'response.create',
    response: {
      conversation: 'auto',
      input: ['user', 'call', 'acknowledged-output'].map((id) => ({
        type: 'item_reference',
        id,
      })),
    },
  });
});

test('trigger dispatch rejects an empty reference snapshot instead of clearing history', () => {
  const commands: object[] = [];
  const errors: unknown[] = [];
  const arbiter = new ResponseArbiter({
    send: (command) => commands.push(command),
    error: (error) => errors.push(error),
    debug: () => {},
    responseInput: () => [],
  });
  arbiter.requestToolFollowUp('user');
  arbiter.referencesChanged();
  expect(commands).toEqual([]);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatchObject({ code: 'ACTIVATION_ELIGIBILITY_FAILED' });
});

test('trigger arbiter refuses unsolicited response creation and completion', () => {
  const commands: object[] = [];
  let ready = false;
  const arbiter = new ResponseArbiter({
    send: (command) => commands.push(command),
    error: () => {},
    debug: () => {},
    responseInput: () => (ready ? ['user'] : undefined),
  });
  arbiter.responseCreated('unsolicited');
  arbiter.usefulDelta('speech');
  expect(commands).toEqual([]);
  arbiter.committed('user');
  arbiter.completed('user', true);
  ready = true;
  arbiter.referencesChanged();
  arbiter.responseDone('unsolicited', false);
  arbiter.committed('next');
  arbiter.completed('next', true);
  expect(commands).toHaveLength(1);
  arbiter.responseCreated('owned');
  arbiter.responseDone('owned', false);
  expect(commands).toHaveLength(2);
});

test('trigger snapshots are copied at dispatch and closed queues cannot resume', () => {
  const commands: object[] = [];
  const ids = ['user'];
  let ready = true;
  const arbiter = new ResponseArbiter({
    send: (command) => commands.push(command),
    error: () => {},
    debug: () => {},
    responseInput: () => (ready ? ids : undefined),
  });
  arbiter.requestToolFollowUp('user');
  ids.push('later');
  expect(commands[0]).toEqual({
    type: 'response.create',
    response: {
      conversation: 'auto',
      input: [{ type: 'item_reference', id: 'user' }],
    },
  });
  arbiter.responseCreated('owned');
  ready = false;
  arbiter.requestToolFollowUp('later');
  arbiter.responseDone('owned', false);
  arbiter.close();
  ready = true;
  arbiter.referencesChanged();
  expect(commands).toHaveLength(1);
});

test('a throwing reference gate fails once without default-input retry', () => {
  const errors: unknown[] = [];
  const commands: object[] = [];
  const arbiter = new ResponseArbiter({
    send: (command) => commands.push(command),
    error: (error) => errors.push(error),
    debug: () => {},
    responseInput: () => {
      throw new Error('unavailable');
    },
  });
  arbiter.requestToolFollowUp('user');
  arbiter.referencesChanged();
  arbiter.requestToolFollowUp('other');
  expect(errors).toHaveLength(1);
  expect(commands).toEqual([]);
});

function harness(options: { readonly throwOn?: string } = {}) {
  const commands: object[] = [];
  const errors: unknown[] = [];
  const debug: string[] = [];
  const arbiter = new ResponseArbiter({
    send: (command) => {
      const type = (command as { type: string }).type;
      if (type === options.throwOn) throw new Error(type);
      commands.push(command);
    },
    error: (error) => errors.push(error),
    debug: (category) => debug.push(category),
  });
  return { arbiter, commands, errors, debug };
}

test('coalesces tools and drains them before eligible turns', () => {
  const { arbiter, commands } = harness();
  arbiter.requestToolFollowUp();
  arbiter.requestToolFollowUp();
  arbiter.completed('turn', true);
  arbiter.committed('turn');
  expect(commands).toEqual([{ type: 'response.create' }]);
  arbiter.responseDone('one', false);
  arbiter.responseDone('two', false);
  expect(commands).toEqual([
    { type: 'response.create' },
    { type: 'response.create' },
    { type: 'response.create' },
  ]);
});

test('requires one correlated committed and useful completed transcript in either order', () => {
  const { arbiter, commands } = harness();
  arbiter.committed(undefined);
  arbiter.committed('empty');
  arbiter.completed('empty', false);
  arbiter.completed('later', true);
  expect(commands).toEqual([]);
  arbiter.committed('later');
  expect(commands).toEqual([{ type: 'response.create' }]);
  arbiter.committed('later');
  arbiter.committed('first');
  arbiter.completed('first', true);
  arbiter.completed('later', true);
  expect(commands).toHaveLength(1);
  arbiter.responseDone('later-response', false);
  expect(commands).toHaveLength(2);
});

test('cancels an active response once and clears output for late activity', () => {
  const { arbiter, commands } = harness();
  arbiter.requestToolFollowUp();
  arbiter.responseCreated('response');
  arbiter.usefulDelta('item');
  arbiter.usefulDelta('item');
  expect(commands).toEqual([
    { type: 'response.create' },
    { type: 'response.cancel', response_id: 'response' },
  ]);
  arbiter.outputStarted();
  arbiter.outputStarted();
  expect(commands).toEqual([
    { type: 'response.create' },
    { type: 'response.cancel', response_id: 'response' },
    { type: 'output_audio_buffer.clear' },
  ]);
});

test('only exact cancelled empty completion releases a clear obligation', () => {
  const { arbiter, commands } = harness();
  arbiter.requestToolFollowUp();
  arbiter.responseCreated('response');
  arbiter.usefulDelta('item');
  arbiter.responseDone('wrong', true);
  arbiter.responseDone('response', false);
  arbiter.outputStarted();
  expect(commands.at(-1)).toEqual({ type: 'output_audio_buffer.clear' });
});

test('malformed, duplicate, and non-empty completion cannot release a clear obligation', () => {
  const { arbiter, commands } = harness();
  arbiter.requestToolFollowUp();
  arbiter.responseCreated('response');
  arbiter.usefulDelta('item');
  arbiter.responseDone(undefined, true);
  arbiter.responseDone('other', true);
  arbiter.responseDone('response', false);
  arbiter.responseDone('response', true);
  arbiter.outputStarted();
  expect(commands).toEqual([
    { type: 'response.create' },
    { type: 'response.cancel', response_id: 'response' },
    { type: 'output_audio_buffer.clear' },
  ]);
});

test('matching cancelled-empty completion releases only its own clear obligation', () => {
  const { arbiter, commands } = harness();
  arbiter.requestToolFollowUp();
  arbiter.responseCreated('response');
  arbiter.usefulDelta('item');
  arbiter.responseDone('response', true);
  arbiter.outputStarted();
  expect(commands).toEqual([
    { type: 'response.create' },
    { type: 'response.cancel', response_id: 'response' },
  ]);
});

test('stopped and cleared output settle pending obligations without another clear', () => {
  for (const settle of ['outputStopped', 'outputCleared'] as const) {
    const { arbiter, commands } = harness();
    arbiter.requestToolFollowUp();
    arbiter.responseCreated('response');
    arbiter.usefulDelta('item');
    arbiter[settle]();
    expect(commands).toHaveLength(2);
  }
});

test('failed create closes the generation without retrying re-entrant work', () => {
  const { arbiter, errors } = harness({ throwOn: 'response.create' });
  arbiter.requestToolFollowUp();
  arbiter.requestToolFollowUp();
  arbiter.completed('turn', true);
  arbiter.committed('turn');
  expect(errors).toHaveLength(1);
});

test('failed cancel and clear report errors without duplicating decisions', () => {
  const cancel = harness({ throwOn: 'response.cancel' });
  cancel.arbiter.requestToolFollowUp();
  cancel.arbiter.responseCreated('response');
  cancel.arbiter.outputStarted();
  cancel.arbiter.usefulDelta('item');
  expect(cancel.errors).toHaveLength(1);

  const clear = harness({ throwOn: 'output_audio_buffer.clear' });
  clear.arbiter.outputStarted();
  clear.arbiter.usefulDelta('item');
  clear.arbiter.usefulDelta('item');
  expect(clear.errors).toHaveLength(1);
});

test('synchronous re-entrant output during cancel emits one clear', () => {
  const commands: object[] = [];
  let arbiter: ResponseArbiter;
  arbiter = new ResponseArbiter({
    send: (command) => {
      commands.push(command);
      if ((command as { type: string }).type === 'response.cancel')
        arbiter.outputStarted();
    },
    error: () => {},
    debug: () => {},
  });
  arbiter.requestToolFollowUp();
  arbiter.responseCreated('response');
  arbiter.usefulDelta('item');
  expect(commands).toEqual([
    { type: 'response.create' },
    { type: 'response.cancel', response_id: 'response' },
    { type: 'output_audio_buffer.clear' },
  ]);
});

test('failed create closes before notifying re-entrant error work', () => {
  const commands: object[] = [];
  let arbiter: ResponseArbiter;
  arbiter = new ResponseArbiter({
    send: (command) => {
      commands.push(command);
      throw new Error('create');
    },
    error: () => arbiter.requestToolFollowUp(),
    debug: () => {},
  });
  arbiter.requestToolFollowUp();
  expect(commands).toEqual([{ type: 'response.create' }]);
});

test('synchronous re-entrant completion during cancel preserves one clear decision', () => {
  const commands: object[] = [];
  let arbiter: ResponseArbiter;
  arbiter = new ResponseArbiter({
    send: (command) => {
      commands.push(command);
      if ((command as { type: string }).type === 'response.cancel')
        arbiter.responseDone('response', true);
    },
    error: () => {},
    debug: () => {},
  });
  arbiter.requestToolFollowUp();
  arbiter.responseCreated('response');
  arbiter.usefulDelta('item');
  expect(commands).toEqual([
    { type: 'response.create' },
    { type: 'response.cancel', response_id: 'response' },
  ]);
});

test('closed old generation cannot command a replacement arbiter', () => {
  const old = harness();
  old.arbiter.requestToolFollowUp();
  old.arbiter.close();
  const replacement = harness();
  replacement.arbiter.requestToolFollowUp();
  old.arbiter.responseCreated('stale');
  old.arbiter.usefulDelta('stale-item');
  expect(old.commands).toEqual([{ type: 'response.create' }]);
  expect(replacement.commands).toEqual([{ type: 'response.create' }]);
});

test('generation close drops queued and settled state', () => {
  const { arbiter, commands } = harness();
  arbiter.completed('turn', true);
  arbiter.committed('turn');
  arbiter.close();
  arbiter.responseDone('old', false);
  arbiter.requestToolFollowUp();
  expect(commands).toEqual([{ type: 'response.create' }]);
});
