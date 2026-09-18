import { describe, expect, it } from 'bun:test';
import FakeTimers from '@sinonjs/fake-timers';
import type { VoiceActivationInput } from './provider-adapter.types.js';
import type { VoiceActivationConfig } from './realtime-session.types.js';
import {
  normalizeVoiceWords,
  VoiceActivationController,
} from './voice-activation.js';

const trigger = { mode: 'trigger', phrase: 'hello maelstrom' } as const;
const turn = (
  ordinal: number,
  text = 'hello maelstrom',
): VoiceActivationInput => ({
  id: String(ordinal),
  ordinal,
  start: ordinal * 10,
  end: ordinal * 10 + 5,
  outcome: 'success',
  text,
});
function setup(config: VoiceActivationConfig = trigger) {
  const errors: unknown[] = [];
  const warnings: string[] = [];
  const controller = new VoiceActivationController(
    config,
    () => {},
    (error) => errors.push(error),
    (category) => warnings.push(category),
  );
  const policy = controller.connect();
  return { controller, policy, errors, warnings };
}

describe('voice activation', () => {
  it('clears the unknown-source deadline once continuing speech is reconciled', async () => {
    const clock = FakeTimers.install();
    try {
      const { controller, policy, errors } = setup();
      policy.reportInput({ id: '1', outcome: 'pending' });
      policy.reportInput({ id: '1', ordinal: 1, start: 0, outcome: 'pending' });
      await clock.tickAsync(20000);
      expect(errors).toHaveLength(0);
      controller.disconnect();
    } finally {
      clock.uninstall();
    }
  });
  it('honors the adapter validated drain-plus-delivery budget without timing out live speech', async () => {
    const clock = FakeTimers.install();
    try {
      const { controller, policy, errors } = setup();
      policy.reportInput({
        id: '1',
        ordinal: 1,
        start: 0,
        outcome: 'pending',
        reconciliationTimeoutMs: 25000,
      });
      await clock.tickAsync(30000);
      expect(errors).toHaveLength(0);
      policy.reportInput({
        id: '1',
        ordinal: 1,
        start: 0,
        end: 1,
        outcome: 'pending',
      });
      await clock.tickAsync(10000);
      expect(errors).toHaveLength(0);
      await clock.tickAsync(15000);
      expect(errors).toHaveLength(1);
      controller.disconnect();
    } finally {
      clock.uninstall();
    }
  });
  it('bounds unresolved records and cannot be revived by late callbacks after failure', () => {
    const { controller, policy, errors } = setup();
    for (let index = 0; index < 129; index++) {
      policy.reportInput({ id: `unknown-${index}`, outcome: 'pending' });
    }
    expect(errors).toHaveLength(1);
    policy.reportInput(turn(1));
    expect(controller.state).toBe('waiting');
    controller.disconnect();
  });

  it('deactivation rejection cannot veto expiry and normal/default chat tokens do nothing', async () => {
    const clock = FakeTimers.install();
    try {
      const { controller, policy, warnings } = setup({
        ...trigger,
        onDeactivate: () => Promise.reject(new Error('private')),
      });
      controller.beginChatActivity();
      policy.reportInput(turn(1));
      await clock.tickAsync(10000);
      expect(controller.state).toBe('waiting');
      expect(warnings).toEqual(['voice activation hook failed']);
      controller.disconnect();
      const normal = setup({ mode: 'normal' });
      normal.controller.beginChatActivity()();
      normal.policy.reportInput(turn(1));
      expect(normal.controller.state).toBe('disabled');
      normal.controller.disconnect();
    } finally {
      clock.uninstall();
    }
  });
  it('does not release a later finalized request ahead of continuing earlier speech', async () => {
    let release!: () => void;
    const { controller, policy } = setup({
      ...trigger,
      onActivate: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    policy.reportInput(turn(1));
    policy.reportInput({ ...turn(2), outcome: 'pending' });
    policy.reportInput(turn(3, 'later request'));
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(policy.admission('2').status).toBe('admitted');
    expect(policy.admission('3').status).toBe('held');
    policy.reportInput(turn(2, 'earlier request'));
    expect(policy.admission('3').status).toBe('admitted');
    controller.disconnect();
  });
  it('does not authorize tools from continuing admitted speech', () => {
    const { controller, policy } = setup();
    policy.reportInput(turn(1));
    policy.reportInput({ ...turn(2), outcome: 'pending' });
    const admission = policy.admission('2');
    if (admission.status !== 'admitted')
      throw new Error('expected speech admission');
    expect(controller.permits(admission.ancestry)).toBe(false);
    policy.reportInput(turn(2, 'weather'));
    expect(controller.permits(admission.ancestry)).toBe(true);
    controller.disconnect();
  });

  it('cannot resurrect activation when timeout abortion disconnects synchronously', async () => {
    const clock = FakeTimers.install();
    try {
      const { controller, policy } = setup({
        ...trigger,
        onActivate: ({ signal }) => {
          signal.addEventListener('abort', () => controller.disconnect());
          return new Promise(() => {});
        },
      });
      policy.reportInput(turn(1));
      await clock.tickAsync(2000);
      expect(controller.state).toBe('waiting');
    } finally {
      clock.uninstall();
    }
  });
  it('normalizes exact words without erasing accents or internal apostrophes', () => {
    for (const phrase of [
      'Hello, Maelstrom!',
      'hello-maelstrom',
      '“HELLO   MAELSTROM!”',
    ]) {
      expect(normalizeVoiceWords(phrase)).toEqual(['hello', 'maelstrom']);
    }
    expect(normalizeVoiceWords('can’t')).toEqual(normalizeVoiceWords("can't"));
    expect(normalizeVoiceWords('cant')).not.toEqual(
      normalizeVoiceWords("can't"),
    );
    expect(normalizeVoiceWords('héllo')).not.toEqual(
      normalizeVoiceWords('hello'),
    );
  });

  it('validates bounded settings before connection', () => {
    for (const phrase of ['', '---', 'x'.repeat(201)]) {
      expect(() => setup({ ...trigger, phrase })).toThrow();
    }
    for (const inactivityMs of [0, 999, 600001, 1000.5, Number.NaN, Infinity]) {
      expect(() => setup({ ...trigger, inactivityMs })).toThrow();
    }
  });

  it('consumes only successful whole exact finals', async () => {
    const { controller, policy } = setup();
    for (const [index, text] of [
      'hellomaelstrom',
      'hello maelstrom show weather',
      'hello maelstrom hello maelstrom',
    ].entries()) {
      policy.reportInput(turn(index + 1, text));
      expect(controller.state).toBe('waiting');
    }
    policy.reportInput({ ...turn(4), outcome: 'error' });
    policy.reportInput({ ...turn(5), outcome: 'empty' });
    policy.reportInput({ ...turn(6), outcome: 'pending' });
    expect(controller.state).toBe('waiting');
    policy.reportInput(turn(6));
    await Promise.resolve();
    expect(controller.state).toBe('active');
    expect(policy.admission('6').status).toBe('excluded');
    controller.disconnect();
  });

  it('holds final-before-trigger-final and continuing requests until the hook settles', async () => {
    let release!: () => void;
    const { controller, policy } = setup({
      ...trigger,
      onActivate: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    policy.reportInput(turn(2, 'weather'));
    expect(policy.admission('2').status).toBe('pending');
    policy.reportInput(turn(1));
    policy.reportInput({ ...turn(3, 'news'), outcome: 'pending' });
    expect(controller.state).toBe('activating');
    expect(policy.admission('2').status).toBe('held');
    expect(policy.admission('3').status).toBe('held');
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(policy.admission('2').status).toBe('admitted');
    expect(policy.admission('3').status).toBe('admitted');
    controller.disconnect();
  });

  it('excludes late preboundary, overlapping and unknown source input', async () => {
    const { controller, policy } = setup();
    policy.reportInput(turn(2));
    expect(controller.state).toBe('waiting');
    policy.reportInput(turn(1, 'ignore'));
    await Promise.resolve();
    policy.reportInput({ ...turn(3, 'overlap'), start: 24 });
    policy.reportInput({
      id: 'unknown',
      outcome: 'success',
      text: 'hello maelstrom',
    });
    policy.reportInput(turn(1));
    expect(policy.admission('1').status).toBe('excluded');
    expect(policy.admission('3').status).toBe('excluded');
    expect(policy.admission('unknown').status).not.toBe('admitted');
    controller.disconnect();
  });

  it('fails open for thrown, rejected and never-settling hooks with fixed warnings', async () => {
    const clock = FakeTimers.install();
    try {
      for (const onActivate of [
        () => {
          throw new Error('private');
        },
        () => Promise.reject(new Error('private')),
        () => new Promise(() => {}),
      ]) {
        const { controller, policy, warnings } = setup({
          ...trigger,
          onActivate,
        });
        policy.reportInput(turn(1));
        policy.reportInput(turn(2, 'weather'));
        await clock.tickAsync(2000);
        expect(controller.state).toBe('active');
        expect(policy.admission('2').status).toBe('admitted');
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).not.toContain('private');
        controller.disconnect();
      }
    } finally {
      clock.uninstall();
    }
  });

  it('starts a full idle interval only after every owned token and held input completes', async () => {
    const clock = FakeTimers.install();
    try {
      const { controller, policy } = setup();
      policy.reportInput(turn(1));
      await clock.tickAsync(0);
      policy.reportInput(turn(2, 'weather'));
      const admission = policy.admission('2');
      if (admission.status !== 'admitted')
        throw new Error('expected admission');
      const response = policy.beginActivity('response', admission.ancestry);
      const playback = policy.beginActivity('playback', admission.ancestry);
      policy.finishInput('2');
      response();
      await clock.tickAsync(20000);
      expect(controller.state).toBe('active');
      response();
      playback();
      await clock.tickAsync(9999);
      expect(controller.state).toBe('active');
      await clock.tickAsync(1);
      expect(controller.state).toBe('waiting');
      policy.reportInput(turn(1));
      expect(controller.state).toBe('waiting');
      expect(policy.admission('2').status).toBe('excluded');
      controller.disconnect();
    } finally {
      clock.uninstall();
    }
  });

  it('new speech aborts deactivation without closing admitted barge-in', async () => {
    const clock = FakeTimers.install();
    try {
      let signal: AbortSignal | undefined;
      let finish!: () => void;
      const { controller, policy } = setup({
        ...trigger,
        onDeactivate: (context) => {
          signal = context.signal;
          return new Promise<void>((resolve) => {
            finish = resolve;
          });
        },
      });
      policy.reportInput(turn(1));
      await clock.tickAsync(10000);
      expect(controller.state).toBe('deactivating');
      policy.reportInput({ ...turn(2), outcome: 'pending' });
      expect(signal?.aborted).toBe(true);
      expect(controller.state).toBe('active');
      expect(policy.admission('2').status).toBe('admitted');
      finish();
      await clock.tickAsync(2000);
      expect(controller.state).toBe('active');
      controller.disconnect();
    } finally {
      clock.uninstall();
    }
  });

  it('fences disconnect callbacks, held replay, hook settlement and chat completions', async () => {
    const clock = FakeTimers.install();
    try {
      let signal: AbortSignal | undefined;
      const { controller, policy } = setup({
        ...trigger,
        includeChatActivity: true,
        onActivate: (context) => {
          signal = context.signal;
          return new Promise(() => {});
        },
      });
      const complete = controller.beginChatActivity();
      policy.reportInput(turn(1));
      policy.reportInput(turn(2, 'weather'));
      controller.disconnect();
      expect(signal?.aborted).toBe(true);
      const replacement = controller.connect();
      policy.reportInput(turn(3));
      complete();
      await clock.tickAsync(20000);
      expect(controller.state).toBe('waiting');
      expect(replacement.admission('2').status).toBe('excluded');
      controller.disconnect();
    } finally {
      clock.uninstall();
    }
  });

  it('chat begun while waiting survives activation but cannot activate it', async () => {
    const clock = FakeTimers.install();
    try {
      const { controller, policy } = setup({
        ...trigger,
        includeChatActivity: true,
      });
      const finish = controller.beginChatActivity();
      expect(controller.state).toBe('waiting');
      policy.reportInput(turn(1));
      await clock.tickAsync(20000);
      expect(controller.state).toBe('active');
      finish();
      finish();
      await clock.tickAsync(10000);
      expect(controller.state).toBe('waiting');
      controller.disconnect();
    } finally {
      clock.uninstall();
    }
  });

  it('fails closed on unresolved deadlines and bounded private text retention', async () => {
    const clock = FakeTimers.install();
    try {
      const first = setup();
      first.policy.reportInput({
        id: 'unknown',
        outcome: 'success',
        text: 'hello maelstrom',
      });
      await clock.tickAsync(10000);
      expect(first.errors).toHaveLength(1);
      expect(first.controller.state).toBe('waiting');
      const second = setup();
      second.policy.reportInput(turn(2, 'x'.repeat(262145)));
      expect(second.errors).toHaveLength(1);
      expect(second.policy.admission('2').status).not.toBe('admitted');
      first.controller.disconnect();
      second.controller.disconnect();
    } finally {
      clock.uninstall();
    }
  });
});
