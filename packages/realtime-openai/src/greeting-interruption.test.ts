import { expect, test } from 'bun:test';
import { GreetingInterruption } from './greeting-interruption.js';
import { MicrophonePublicationGate } from './microphone-publication-gate.js';

function enabledConfig() {
  return {
    enabled: true as const,
    assetBaseUrl: '/vad-web/',
    preRollMs: 123,
    providerOptions: {},
  };
}

test('disabled preparation keeps raw publication and does not load runtime', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const stream = { getAudioTracks: () => [raw] } as unknown as MediaStream;
  let loads = 0;
  const owner = new GreetingInterruption({
    config: { enabled: false },
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () => {
      loads += 1;
      throw new Error('must not load');
    },
    debug: () => {},
  });
  const prepared = await owner.prepareAndRemember(stream);
  expect(prepared.rawStream).toBe(stream);
  expect(prepared.track).toBe(raw);
  expect(prepared.generated).toBe(false);
  expect(loads).toBe(0);
});

test('accepts one armed local boundary by stopping playback before automatic pre-roll', async () => {
  const raw = { enabled: true, stop: () => {} } as unknown as MediaStreamTrack;
  const generated = {
    enabled: true,
    stop: () => {},
  } as unknown as MediaStreamTrack;
  const order: string[] = [];
  let startTurn: (() => Promise<void>) | undefined;
  let endTurn: (() => Promise<void>) | undefined;
  let cancelTurn: (() => Promise<void>) | undefined;
  let destroys = 0;
  const bridge = {
    track: generated,
    startAutomaticTurn: async (preRollMs: number) => {
      order.push(`automatic:${preRollMs}`);
    },
    startManualTurn: async () => {
      order.push('manual');
    },
    clear: async () => {},
    endTurn: async () => {},
    destroy: async () => {},
  };
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => bridge,
        createBrowserVad: async (options: {
          stream: MediaStream;
          startTurn: () => Promise<void>;
          endTurn: () => Promise<void>;
          cancelTurn: () => Promise<void>;
        }) => {
          expect(options.stream).toBe(rawStream);
          startTurn = options.startTurn;
          endTurn = options.endTurn;
          cancelTurn = options.cancelTurn;
          return {
            destroy: async () => {
              destroys += 1;
            },
          };
        },
      }) as never,
    debug: () => {},
  });
  const rawStream = { getAudioTracks: () => [raw] } as unknown as MediaStream;
  const prepared = await owner.prepareAndRemember(rawStream);
  owner.commit(prepared, {} as RTCRtpSender, 1);
  const operation = owner.begin(() => order.push('stop'));
  if (!operation) throw new Error('expected enabled operation');

  operation.arm();
  await Promise.resolve();
  await startTurn?.();
  await startTurn?.();
  await endTurn?.();
  await cancelTurn?.();
  await operation.settle();

  expect(order).toEqual(['stop', 'automatic:123']);
  expect(generated.enabled).toBe(true);
  expect(raw.enabled).toBe(true);
  expect(destroys).toBe(1);
});

test('settlement waits for a late VAD result and retires it once', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  let resolveVad!: (value: { destroy(): Promise<void> }) => void;
  let destroys = 0;
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async () => {},
          startManualTurn: async () => {},
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {},
        }),
        createBrowserVad: async () =>
          new Promise((resolve) => {
            resolveVad = resolve;
          }),
      }) as never,
    debug: () => {},
  });
  const prepared = await owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  owner.commit(prepared, {} as RTCRtpSender, 1);
  const operation = owner.begin(() => {});
  if (!operation) throw new Error('expected enabled operation');
  operation.arm();
  const settled = operation.settle();
  let complete = false;
  void settled.then(() => {
    complete = true;
  });
  await Promise.resolve();
  expect(complete).toBe(false);
  resolveVad({
    destroy: async () => {
      destroys += 1;
    },
  });
  await settled;
  expect(destroys).toBe(1);
});

test('stale local boundaries cannot become valid after a generation changes', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  let generation = 1;
  let startTurn: (() => Promise<void>) | undefined;
  let automatic = 0;
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => generation),
    generation: () => generation,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async () => {
            automatic += 1;
          },
          startManualTurn: async () => {},
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {},
        }),
        createBrowserVad: async (options: { startTurn(): Promise<void> }) => {
          startTurn = options.startTurn;
          return { destroy: async () => {} };
        },
      }) as never,
    debug: () => {},
  });
  const prepared = await owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  owner.commit(prepared, {} as RTCRtpSender, 1);
  const operation = owner.begin(() => {});
  if (!operation) throw new Error('expected enabled operation');
  operation.arm();
  await Promise.resolve();
  generation = 2;
  await startTurn?.();
  expect(automatic).toBe(0);
  await operation.settle();
});

test('a pre-arm local boundary is ignored and cannot become valid after arm', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  let startTurn: (() => Promise<void>) | undefined;
  let automatic = 0;
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async () => {
            automatic += 1;
          },
          startManualTurn: async () => {},
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {},
        }),
        createBrowserVad: async (options: { startTurn(): Promise<void> }) => {
          startTurn = options.startTurn;
          return { destroy: async () => {} };
        },
      }) as never,
    debug: () => {},
  });
  const prepared = await owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  owner.commit(prepared, {} as RTCRtpSender, 1);
  const operation = owner.begin(() => {});
  if (!operation) throw new Error('expected enabled operation');

  operation.arm();
  await Promise.resolve();
  const oldBoundary = startTurn;
  operation.disarm();
  operation.arm();
  // A fake local boundary can represent noise or echo; it is not speech proof.
  await oldBoundary?.();
  // The old callback cannot become valid under the later arm epoch.
  expect(automatic).toBe(0);
  await operation.settle();
  expect(automatic).toBe(0);
});

test('Skip settles manual publication before releasing the generated gate', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const mutations: boolean[] = [];
  let generatedEnabled = true;
  const generated = {
    get enabled() {
      return generatedEnabled;
    },
    set enabled(value: boolean) {
      generatedEnabled = value;
      mutations.push(value);
    },
  } as MediaStreamTrack;
  const order: string[] = [];
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async () => {},
          startManualTurn: async () => {
            order.push(`manual:${generated.enabled}`);
          },
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {},
        }),
        createBrowserVad: async () => ({ destroy: async () => {} }),
      }) as never,
    debug: () => {},
  });
  const prepared = await owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  owner.commit(prepared, {} as RTCRtpSender, 1);
  const operation = owner.begin(() => {});
  if (!operation) throw new Error('expected enabled operation');

  operation.disarm(); // Skip fences callbacks synchronously before settlement.
  await operation.settle();
  expect(order).toEqual(['manual:false']);
  expect(mutations).toEqual([false, true]);
  expect(raw.enabled).toBe(true);
});

test('a replaced operation cannot accept from its stale local boundary', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  const callbacks: Array<() => Promise<void>> = [];
  let automatic = 0;
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async () => {
            automatic += 1;
          },
          startManualTurn: async () => {},
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {},
        }),
        createBrowserVad: async (options: { startTurn(): Promise<void> }) => {
          callbacks.push(options.startTurn);
          return { destroy: async () => {} };
        },
      }) as never,
    debug: () => {},
  });
  const prepared = await owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  owner.commit(prepared, {} as RTCRtpSender, 1);
  const first = owner.begin(() => {});
  if (!first) throw new Error('expected first operation');
  first.arm();
  await Promise.resolve();
  const second = owner.begin(() => {});
  if (!second) throw new Error('expected second operation');
  await callbacks[0]?.();
  expect(automatic).toBe(0);
  await first.settle();
  await second.settle();
});

test('normal settlement discards greeting-period audio before releasing publication', async () => {
  const raw = { enabled: true, stop: () => {} } as unknown as MediaStreamTrack;
  const generated = {
    enabled: true,
    stop: () => {},
  } as unknown as MediaStreamTrack;
  const order: string[] = [];
  const bridge = {
    track: generated,
    startAutomaticTurn: async () => {},
    startManualTurn: async () => {
      order.push('manual');
    },
    clear: async () => {},
    endTurn: async () => {},
    destroy: async () => {},
  };
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => bridge,
        createBrowserVad: async () => ({ destroy: async () => {} }),
      }) as never,
    debug: () => {},
  });
  const prepared = await owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  owner.commit(prepared, {} as RTCRtpSender, 1);
  const operation = owner.begin(() => {});
  if (!operation) throw new Error('expected enabled operation');

  await operation.settle();
  expect(order).toEqual(['manual']);
  expect(generated.enabled).toBe(true);
});

test('loader rejection returns raw publication and emits runtime-unavailable', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const diagnostics: string[] = [];
  const bridgeCreates = 0;
  const vadCreates = 0;
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () => {
      throw new Error('chunk missing');
    },
    debug: (category) => diagnostics.push(category),
  });
  const prepared = await owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  expect(prepared.generated).toBe(false);
  expect(prepared.track).toBe(raw);
  expect(bridgeCreates).toBe(0);
  expect(vadCreates).toBe(0);
  expect(diagnostics).toEqual(['runtime-unavailable']);
  expect(owner.begin(() => {})).toBeUndefined();
});

test('bridge creation rejection returns raw publication and stores no bridge', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const diagnostics: string[] = [];
  let vadCreates = 0;
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => {
          throw new Error('worklet missing');
        },
        createBrowserVad: async () => {
          vadCreates += 1;
          return { destroy: async () => {} };
        },
      }) as never,
    debug: (category) => diagnostics.push(category),
  });
  const prepared = await owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  expect(prepared.generated).toBe(false);
  expect(prepared.track).toBe(raw);
  expect(vadCreates).toBe(0);
  expect(diagnostics).toEqual(['bridge-unavailable']);
  expect(owner.begin(() => {})).toBeUndefined();
});

test('post-attachment VAD setup failure replaces after disabling raw', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  const order: string[] = [];
  const diagnostics: string[] = [];
  let destroyed = 0;
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async () => order.push('automatic'),
          startManualTurn: async () => order.push('manual'),
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {
            destroyed += 1;
          },
        }),
        createBrowserVad: async () => {
          throw new Error('vad start');
        },
      }) as never,
    replacePublication: async ({ raw: rawTrack }) => {
      order.push(`replace:${rawTrack.enabled}`);
      return 'replaced';
    },
    debug: (category) => diagnostics.push(category),
  });
  const prepared = await owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  owner.commit(prepared, {} as RTCRtpSender, 1);
  const operation = owner.begin(() => order.push('stop'));
  if (!operation) throw new Error('expected enabled operation');
  operation.arm();
  for (let attempt = 0; attempt < 10 && order.length < 2; attempt += 1)
    await Promise.resolve();
  expect(order).toEqual(['stop', 'replace:false']);
  await operation.settle();
  expect(destroyed).toBe(1);
  expect(diagnostics).toEqual(['vad-unavailable', 'publication-replaced']);
  expect(order).not.toContain('automatic');
  expect(order).not.toContain('manual');
  expect(owner.begin(() => {})).toBeUndefined();
});

test('onFailure before acceptance follows the same raw-gated recovery', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  let onFailure: (() => Promise<void>) | undefined;
  const order: string[] = [];
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async () => order.push('automatic'),
          startManualTurn: async () => order.push('manual'),
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {},
        }),
        createBrowserVad: async (options: { onFailure(): Promise<void> }) => {
          onFailure = options.onFailure;
          return { destroy: async () => {} };
        },
      }) as never,
    replacePublication: async ({ raw: rawTrack }) => {
      order.push(`replace:${rawTrack.enabled}`);
      return 'replaced';
    },
    debug: () => {},
  });
  const prepared = await owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  owner.commit(prepared, {} as RTCRtpSender, 1);
  const operation = owner.begin(() => order.push('stop'));
  if (!operation) throw new Error('expected enabled operation');
  operation.arm();
  await Promise.resolve();
  await onFailure?.();
  expect(order).toEqual(['stop', 'replace:false']);
  await operation.settle();
  expect(order).not.toContain('automatic');
});

test('automatic-start failure replaces and resumes live raw without claiming a flush', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  const order: string[] = [];
  let startTurn: (() => Promise<void>) | undefined;
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async () => {
            throw new Error('ack timeout');
          },
          startManualTurn: async () => order.push('manual'),
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {},
        }),
        createBrowserVad: async (options: { startTurn(): Promise<void> }) => {
          startTurn = options.startTurn;
          return { destroy: async () => {} };
        },
      }) as never,
    replacePublication: async ({ raw: rawTrack }) => {
      order.push(`replace:${rawTrack.enabled}`);
      return 'replaced';
    },
    debug: () => {},
  });
  const prepared = await owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  owner.commit(prepared, {} as RTCRtpSender, 1);
  const operation = owner.begin(() => order.push('stop'));
  if (!operation) throw new Error('expected enabled operation');
  operation.arm();
  await Promise.resolve();
  await startTurn?.();
  expect(order[0]).toBe('stop');
  expect(order).toContain('replace:false');
  expect(raw.enabled).toBe(true);
  await operation.settle();
  expect(order).not.toContain('manual');
});

test('manual-start failure keeps the gate until settlement then resumes live raw', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  const order: string[] = [];
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async () => {},
          startManualTurn: async () => {
            throw new Error('ack timeout');
          },
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {},
        }),
        createBrowserVad: async () => ({ destroy: async () => {} }),
      }) as never,
    replacePublication: async ({ raw: rawTrack }) => {
      order.push(`replace:${rawTrack.enabled}`);
      return 'replaced';
    },
    debug: () => {},
  });
  const prepared = await owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  owner.commit(prepared, {} as RTCRtpSender, 1);
  const operation = owner.begin(() => {});
  if (!operation) throw new Error('expected enabled operation');
  await operation.settle();
  expect(order).toEqual(['replace:false']);
  expect(raw.enabled).toBe(true);
});

test('failed replace leaves generated and raw gated', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async () => {},
          startManualTurn: async () => {
            throw new Error('ack timeout');
          },
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {},
        }),
        createBrowserVad: async () => ({ destroy: async () => {} }),
      }) as never,
    replacePublication: async () => 'failed',
    debug: () => {},
  });
  const prepared = await owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  owner.commit(prepared, {} as RTCRtpSender, 1);
  const operation = owner.begin(() => {});
  if (!operation) throw new Error('expected enabled operation');
  await operation.settle();
  expect(raw.enabled).toBe(false);
  expect(generated.enabled).toBe(false);
});

test('stale replace cannot mutate a newer generation sender', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  let generation = 1;
  let replaced = 0;
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => generation),
    generation: () => generation,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async () => {},
          startManualTurn: async () => {
            throw new Error('ack timeout');
          },
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {},
        }),
        createBrowserVad: async () => ({ destroy: async () => {} }),
      }) as never,
    replacePublication: async ({ generation: requested }) => {
      if (requested !== generation) return 'stale';
      replaced += 1;
      return 'replaced';
    },
    debug: () => {},
  });
  const prepared = await owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  owner.commit(prepared, {} as RTCRtpSender, 1);
  const operation = owner.begin(() => {});
  if (!operation) throw new Error('expected enabled operation');
  generation = 2;
  await operation.settle();
  expect(replaced).toBe(0);
});

test('a local boundary labeled as possible playback echo still follows stop-before-replace ordering', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  const order: string[] = [];
  let startTurn: (() => Promise<void>) | undefined;
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async () => {
            throw new Error('ack timeout');
          },
          startManualTurn: async () => {},
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {},
        }),
        createBrowserVad: async (options: { startTurn(): Promise<void> }) => {
          startTurn = options.startTurn;
          return { destroy: async () => {} };
        },
      }) as never,
    replacePublication: async () => {
      order.push('replace');
      return 'replaced';
    },
    debug: () => {},
  });
  const prepared = await owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  owner.commit(prepared, {} as RTCRtpSender, 1);
  const operation = owner.begin(() => order.push('stop'));
  if (!operation) throw new Error('expected enabled operation');
  operation.arm();
  await Promise.resolve();
  // A local acceptance may be echo or noise; this only asserts command order.
  await startTurn?.();
  expect(order[0]).toBe('stop');
  expect(order).toContain('replace');
});

test('a hanging automatic acknowledgement times out and recovers without a flush', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  const order: string[] = [];
  let startTurn: (() => Promise<void>) | undefined;
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    commandTimeoutMs: 5,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: () => new Promise(() => {}),
          startManualTurn: async () => order.push('manual'),
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {},
        }),
        createBrowserVad: async (options: { startTurn(): Promise<void> }) => {
          startTurn = options.startTurn;
          return { destroy: async () => {} };
        },
      }) as never,
    replacePublication: async () => {
      order.push('replace');
      return 'replaced';
    },
    debug: () => {},
  });
  const prepared = await owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  owner.commit(prepared, {} as RTCRtpSender, 1);
  const operation = owner.begin(() => order.push('stop'));
  if (!operation) throw new Error('expected enabled operation');
  operation.arm();
  await Promise.resolve();
  const accepted = startTurn?.();
  await accepted;
  expect(order).toEqual(['stop', 'replace']);
  expect(order).not.toContain('manual');
});

test('a hanging manual acknowledgement times out and recovers', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  let replaced = 0;
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    commandTimeoutMs: 5,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async () => {},
          startManualTurn: () => new Promise(() => {}),
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {},
        }),
        createBrowserVad: async () => ({ destroy: async () => {} }),
      }) as never,
    replacePublication: async () => {
      replaced += 1;
      return 'replaced';
    },
    debug: () => {},
  });
  const prepared = await owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  owner.commit(prepared, {} as RTCRtpSender, 1);
  const operation = owner.begin(() => {});
  if (!operation) throw new Error('expected enabled operation');
  await operation.settle();
  expect(replaced).toBe(1);
  expect(raw.enabled).toBe(true);
});

test('delayed VAD and bridge after destroy are retired locally', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  let resolveVad!: (value: { destroy(): Promise<void> }) => void;
  let resolveBridge!: (value: {
    track: MediaStreamTrack;
    startAutomaticTurn(): Promise<void>;
    startManualTurn(): Promise<void>;
    clear(): Promise<void>;
    endTurn(): Promise<void>;
    destroy(): Promise<void>;
  }) => void;
  let vadDestroys = 0;
  let bridgeDestroys = 0;
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: () =>
          new Promise((resolve) => {
            resolveBridge = resolve;
          }),
        createBrowserVad: () =>
          new Promise((resolve) => {
            resolveVad = resolve;
          }),
      }) as never,
    replacePublication: async () => 'replaced',
    debug: () => {},
  });
  const preparing = owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  for (let attempt = 0; attempt < 10 && !resolveBridge; attempt += 1)
    await Promise.resolve();
  await owner.destroy();
  resolveBridge({
    track: generated,
    startAutomaticTurn: async () => {},
    startManualTurn: async () => {},
    clear: async () => {},
    endTurn: async () => {},
    destroy: async () => {
      bridgeDestroys += 1;
    },
  });
  const prepared = await preparing;
  expect(prepared.generated).toBe(false);
  expect(bridgeDestroys).toBe(1);
  expect(owner.begin(() => {})).toBeUndefined();
  resolveVad?.({
    destroy: async () => {
      vadDestroys += 1;
    },
  });
  await Promise.resolve();
  expect(vadDestroys).toBe(0);
});

test('local boundaries after natural end, Skip, or replacement cannot recover or flush twice', async () => {
  const raw = { enabled: true } as MediaStreamTrack;
  const generated = { enabled: true } as MediaStreamTrack;
  const callbacks: Array<() => Promise<void>> = [];
  let automatic = 0;
  let replaced = 0;
  const owner = new GreetingInterruption({
    config: enabledConfig(),
    gate: new MicrophonePublicationGate(() => 1),
    generation: () => 1,
    loadRuntime: async () =>
      ({
        createLocalAudioPreRoll: async () => ({
          track: generated,
          startAutomaticTurn: async () => {
            automatic += 1;
          },
          startManualTurn: async () => {},
          clear: async () => {},
          endTurn: async () => {},
          destroy: async () => {},
        }),
        createBrowserVad: async (options: { startTurn(): Promise<void> }) => {
          callbacks.push(options.startTurn);
          return { destroy: async () => {} };
        },
      }) as never,
    replacePublication: async () => {
      replaced += 1;
      return 'replaced';
    },
    debug: () => {},
  });
  const prepared = await owner.prepareAndRemember({
    getAudioTracks: () => [raw],
  } as unknown as MediaStream);
  owner.commit(prepared, {} as RTCRtpSender, 1);
  const first = owner.begin(() => {});
  if (!first) throw new Error('expected first operation');
  first.arm();
  await Promise.resolve();
  await first.settle();
  await callbacks[0]?.();
  expect(automatic).toBe(0);
  expect(replaced).toBe(0);

  const skipped = owner.begin(() => {});
  if (!skipped) throw new Error('expected skip operation');
  skipped.disarm();
  await skipped.settle();
  await callbacks[1]?.();
  expect(automatic).toBe(0);
  expect(replaced).toBe(0);

  const current = owner.begin(() => {});
  if (!current) throw new Error('expected current operation');
  current.arm();
  await Promise.resolve();
  await callbacks[1]?.();
  await callbacks[2]?.();
  await callbacks[2]?.();
  expect(automatic).toBe(1);
  expect(replaced).toBe(0);
  await current.settle();
});
