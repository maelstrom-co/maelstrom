import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type ControlledReferenceWindow,
  installControlledMicrophoneReference,
} from './controlled-reference-microphone.ts';

function track(dsp: boolean) {
  return {
    enabled: true,
    readyState: 'live',
    stopped: 0,
    settings: {
      deviceId: 'private-device',
      groupId: 'private-group',
      echoCancellation: dsp,
      noiseSuppression: dsp,
      autoGainControl: dsp,
      sampleRate: 48_000,
    },
    getSettings() {
      return { ...this.settings };
    },
    stop() {
      this.stopped++;
      this.readyState = 'ended';
    },
  };
}
const stream = (source: ReturnType<typeof track>) =>
  ({
    getTracks: () => [source],
    getAudioTracks: () => [source],
  }) as unknown as MediaStream;

async function withReference(
  check: (
    hook: NonNullable<ControlledReferenceWindow['__voiceReferenceMicrophone']>,
  ) => Promise<void>,
  acquisitionTimeoutMs = 2_000,
) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const target = {} as ControlledReferenceWindow;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: target,
  });
  try {
    installControlledMicrophoneReference({ acquisitionTimeoutMs });
    assert.ok(target.__voiceReferenceMicrophone);
    await check(target.__voiceReferenceMicrophone);
  } finally {
    target.__voiceReferenceMicrophone?.dispose();
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

test('verifies exact-device DSP-off reference without changing or stopping the app track', async () => {
  await withReference(async (hook) => {
    const app = track(true),
      reference = track(false);
    const appStream = stream(app),
      referenceStream = stream(reference);
    let requested: MediaStreamConstraints | undefined;
    const result = await hook.acquire(async (constraints) => {
      requested = constraints;
      return referenceStream;
    }, appStream);
    assert.equal(result, referenceStream);
    assert.deepEqual(requested, {
      audio: {
        deviceId: { exact: 'private-device' },
        echoCancellation: { exact: false },
        noiseSuppression: { exact: false },
        autoGainControl: { exact: false },
      },
    });
    assert.deepEqual(hook.snapshot(), {
      status: 'verified',
      reason: null,
      sameDevice: true,
      referenceDspOff: true,
      appTrackUnchanged: true,
    });
    assert.doesNotMatch(
      JSON.stringify(hook.snapshot()),
      /private-device|private-group|sampleRate/,
    );
    assert.equal(app.settings.echoCancellation, true);
    assert.equal(app.enabled, true);
    hook.dispose();
    assert.equal(reference.stopped, 1);
    assert.equal(app.stopped, 0);
  });
});

test('fails closed on mismatched device, unverifiable DSP or changed app settings/state', async () => {
  for (const mode of ['device', 'dsp', 'settings', 'enabled'] as const) {
    await withReference(async (hook) => {
      const app = track(true),
        reference = track(false);
      if (mode === 'device') reference.settings.deviceId = 'other-device';
      if (mode === 'dsp') reference.settings.echoCancellation = true;
      await assert.rejects(
        hook.acquire(async () => {
          if (mode === 'settings') app.settings.sampleRate = 44_100;
          if (mode === 'enabled') app.enabled = false;
          return stream(reference);
        }, stream(app)),
        /Controlled fixture reference unavailable/,
      );
      assert.equal(hook.snapshot().status, 'unavailable');
      assert.equal(reference.stopped, 1);
      assert.equal(app.stopped, 0);
    });
  }
});

test('never stops an app track returned by an invalid non-independent acquisition', async () => {
  await withReference(async (hook) => {
    const app = track(true);
    const appStream = stream(app);
    await assert.rejects(
      hook.acquire(async () => appStream, appStream),
      /reference-track-not-independent/,
    );
    assert.equal(app.stopped, 0);
  });
});

test('late reference acquisition after disposal is stopped without leaking the app track', async () => {
  await withReference(async (hook) => {
    const app = track(true),
      reference = track(false);
    let release!: (stream: MediaStream) => void;
    const pending = hook.acquire(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      stream(app),
    );
    hook.dispose();
    release(stream(reference));
    await assert.rejects(pending, /disposed/);
    assert.equal(reference.stopped, 1);
    assert.equal(app.stopped, 0);
  });
});

test('concurrent acquisition fails closed and retires a late reference', async () => {
  await withReference(async (hook) => {
    const app = track(true),
      reference = track(false);
    const appStream = stream(app);
    let release!: (stream: MediaStream) => void;
    const pending = hook.acquire(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      appStream,
    );
    await assert.rejects(
      hook.acquire(async () => stream(reference), appStream),
      /concurrent-reference-acquisition/,
    );
    release(stream(reference));
    await assert.rejects(pending, /concurrent-reference-acquisition/);
    assert.equal(reference.stopped, 1);
    assert.equal(app.stopped, 0);
  });
});

test('a timed-out reference cannot block app acquisition or leak a late track', async () => {
  await withReference(async (hook) => {
    const app = track(true),
      reference = track(false);
    let release!: (stream: MediaStream) => void;
    const pending = hook.acquire(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      stream(app),
    );
    await assert.rejects(pending, /reference-acquisition-timed-out/);
    release(stream(reference));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(reference.stopped, 1);
    assert.equal(app.stopped, 0);
  }, 10);
});

test('an inactive app track does not authorize independent capture', async () => {
  await withReference(async (hook) => {
    const app = track(true);
    app.enabled = false;
    let calls = 0;
    await assert.rejects(
      hook.acquire(async () => {
        calls++;
        return stream(track(false));
      }, stream(app)),
      /app-track-not-active/,
    );
    assert.equal(calls, 0);
  });
});
