import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { WebAudioGreetingPlayer } from './web-audio-greeting-player.js';

// ---------------------------------------------------------------------------
// Bun Web Audio fakes (no happy-dom)
// ---------------------------------------------------------------------------

class FakeAudioBuffer {
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {}
}

class FakeAudioBufferSourceNode {
  buffer: FakeAudioBuffer | null = null;
  onended: (() => void) | null = null;
  connectedTo: unknown = null;
  started = false;
  stopped = false;
  disconnected = false;
  startError: Error | undefined;
  stopError: Error | undefined;

  connect(destination: unknown): void {
    this.connectedTo = destination;
  }

  disconnect(): void {
    this.disconnected = true;
  }

  start(_when?: number): void {
    if (this.startError) throw this.startError;
    this.started = true;
  }

  stop(_when?: number): void {
    if (this.stopError) throw this.stopError;
    this.stopped = true;
  }

  /** Test helper: fire the ended callback. */
  end(): void {
    this.onended?.();
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];

  readonly destination = { kind: 'destination' as const };
  readonly sampleRate = 44100;
  state: AudioContextState = 'suspended';
  resumeCalls = 0;
  createBufferCalls: Array<{
    channels: number;
    length: number;
    sampleRate: number;
  }> = [];
  sources: FakeAudioBufferSourceNode[] = [];
  decodeCalls: ArrayBuffer[] = [];
  resumeImpl: () => Promise<void> = async () => {
    this.state = 'running';
  };
  decodeImpl: (data: ArrayBuffer) => Promise<FakeAudioBuffer> = async () =>
    new FakeAudioBuffer(1, 8, this.sampleRate);

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  resume(): Promise<void> {
    this.resumeCalls += 1;
    return this.resumeImpl();
  }

  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ): FakeAudioBuffer {
    this.createBufferCalls.push({
      channels: numberOfChannels,
      length,
      sampleRate,
    });
    return new FakeAudioBuffer(numberOfChannels, length, sampleRate);
  }

  createBufferSource(): FakeAudioBufferSourceNode {
    const source = new FakeAudioBufferSourceNode();
    this.sources.push(source);
    return source;
  }

  async decodeAudioData(data: ArrayBuffer): Promise<FakeAudioBuffer> {
    this.decodeCalls.push(data);
    return this.decodeImpl(data);
  }

  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }
}

async function waitForPlaybackSource(
  ctx: FakeAudioContext,
): Promise<FakeAudioBufferSourceNode> {
  for (let i = 0; i < 20; i += 1) {
    if (ctx.sources.length >= 2 && ctx.sources.at(-1)?.started) {
      return ctx.sources.at(-1)!;
    }
    await Promise.resolve();
  }
  throw new Error('playback source never started');
}

function makePlayer(): {
  player: WebAudioGreetingPlayer;
  latestContext: () => FakeAudioContext;
} {
  return {
    player: new WebAudioGreetingPlayer({
      createAudioContext: () =>
        new FakeAudioContext() as unknown as AudioContext,
    }),
    latestContext: () => {
      const ctx = FakeAudioContext.instances.at(-1);
      if (!ctx) throw new Error('no FakeAudioContext');
      return ctx;
    },
  };
}

beforeEach(() => {
  FakeAudioContext.instances = [];
});

afterEach(() => {
  FakeAudioContext.instances = [];
});

describe('WebAudioGreetingPlayer', () => {
  it('begins AudioContext construction, resume, silent source create/connect/start synchronously in activate()', () => {
    const { player } = makePlayer();
    expect(FakeAudioContext.instances).toHaveLength(0);

    player.activate();

    expect(FakeAudioContext.instances).toHaveLength(1);
    const ctx = FakeAudioContext.instances[0]!;
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.createBufferCalls).toEqual([
      { channels: 1, length: 1, sampleRate: 44100 },
    ]);
    expect(ctx.sources).toHaveLength(1);
    const silent = ctx.sources[0]!;
    expect(silent.buffer).toBeInstanceOf(FakeAudioBuffer);
    expect(silent.connectedTo).toBe(ctx.destination);
    expect(silent.started).toBe(true);
  });

  it('reuses the same AudioContext on repeated activation and may resume again', () => {
    const { player } = makePlayer();
    player.activate();
    player.activate();
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0]!.resumeCalls).toBe(2);
    // Second activation starts another silent unlock source on the same context.
    expect(FakeAudioContext.instances[0]!.sources).toHaveLength(2);
  });

  it('readiness fails for no activation, resume rejection, and pre-abort', async () => {
    const { player } = makePlayer();
    const live = new AbortController();

    await expect(player.ensureReady(live.signal)).resolves.toEqual({
      ok: false,
      reason: 'not_activated',
    });

    const failCtxFactory = () => {
      const ctx = new FakeAudioContext();
      ctx.resumeImpl = async () => {
        throw new Error('resume denied');
      };
      return ctx as unknown as AudioContext;
    };
    const failing = new WebAudioGreetingPlayer({
      createAudioContext: failCtxFactory,
    });
    failing.activate();
    await expect(failing.ensureReady(live.signal)).resolves.toEqual({
      ok: false,
      reason: 'resume_failed',
    });

    const aborted = new AbortController();
    aborted.abort();
    const readyPlayer = makePlayer();
    readyPlayer.player.activate();
    await expect(
      readyPlayer.player.ensureReady(aborted.signal),
    ).resolves.toEqual({ ok: false, reason: 'aborted' });
  });

  it('decodes a defensive copy of WAV bytes and resolves play only on onended', async () => {
    const { player, latestContext } = makePlayer();
    player.activate();
    const ctx = latestContext();

    const original = new ArrayBuffer(16);
    new Uint8Array(original).set([1, 2, 3, 4]);
    const signal = new AbortController().signal;

    const playPromise = player.play(original, signal);
    const playback = await waitForPlaybackSource(ctx);

    expect(ctx.decodeCalls).toHaveLength(1);
    const decodedArg = ctx.decodeCalls[0]!;
    expect(decodedArg).not.toBe(original);
    expect(new Uint8Array(decodedArg)).toEqual(new Uint8Array(original));

    expect(playback.started).toBe(true);
    expect(playback.connectedTo).toBe(ctx.destination);

    let settled = false;
    void playPromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    playback.end();
    await playPromise;
    expect(settled).toBe(true);
  });

  it('abort during playback stops/disconnects and settles once', async () => {
    const { player, latestContext } = makePlayer();
    player.activate();
    const controller = new AbortController();

    const playPromise = player.play(new ArrayBuffer(8), controller.signal);
    const playback = await waitForPlaybackSource(latestContext());

    const settleSpy = mock(() => {});
    void playPromise.then(settleSpy, settleSpy);

    controller.abort();
    await playPromise;

    expect(playback.stopped).toBe(true);
    expect(playback.disconnected).toBe(true);
    expect(settleSpy).toHaveBeenCalledTimes(1);

    // onended after abort must not double-settle / throw.
    playback.end();
    await Promise.resolve();
    expect(settleSpy).toHaveBeenCalledTimes(1);
  });

  it('stop() is idempotent and does not close the context', async () => {
    const { player, latestContext } = makePlayer();
    player.activate();
    const ctx = latestContext();

    const playPromise = player.play(
      new ArrayBuffer(8),
      new AbortController().signal,
    );
    const playback = await waitForPlaybackSource(ctx);

    player.stop();
    await playPromise;

    expect(playback.stopped).toBe(true);
    expect(playback.disconnected).toBe(true);
    expect(ctx.state).not.toBe('closed');

    // Idempotent.
    player.stop();
    player.stop();
    expect(ctx.state).not.toBe('closed');
  });

  it('stop() during decode settles without hanging', async () => {
    const { player, latestContext } = makePlayer();
    player.activate();
    const ctx = latestContext();

    let releaseDecode!: (buffer: FakeAudioBuffer) => void;
    ctx.decodeImpl = () =>
      new Promise<FakeAudioBuffer>((resolve) => {
        releaseDecode = resolve;
      });

    const playPromise = player.play(
      new ArrayBuffer(8),
      new AbortController().signal,
    );
    await Promise.resolve();
    expect(ctx.decodeCalls).toHaveLength(1);

    player.stop();
    await playPromise;

    // Late decode completion must not start a source or hang.
    releaseDecode(new FakeAudioBuffer(1, 8, ctx.sampleRate));
    await Promise.resolve();
    await Promise.resolve();
    // Only the silent unlock source.
    expect(ctx.sources).toHaveLength(1);
  });

  it('treats InvalidStateError from stop as benign', async () => {
    const { player, latestContext } = makePlayer();
    player.activate();

    const playPromise = player.play(
      new ArrayBuffer(8),
      new AbortController().signal,
    );
    const playback = await waitForPlaybackSource(latestContext());
    const err = new Error('already stopped');
    err.name = 'InvalidStateError';
    playback.stopError = err;

    player.stop();
    await playPromise;
    expect(playback.disconnected).toBe(true);
  });

  it('ensureReady aborts while resume hangs without ever releasing resume', async () => {
    const ctxFactory = () => {
      const ctx = new FakeAudioContext();
      ctx.resumeImpl = () => new Promise<void>(() => {});
      return ctx as unknown as AudioContext;
    };
    const player = new WebAudioGreetingPlayer({
      createAudioContext: ctxFactory,
    });
    player.activate();

    const controller = new AbortController();
    const ready = player.ensureReady(controller.signal);
    let settled = false;
    void ready.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    controller.abort();
    await expect(ready).resolves.toEqual({ ok: false, reason: 'aborted' });
  });

  it('reports unlock_failed when silent start throws even if resume later succeeds', async () => {
    const ctxFactory = () => {
      const ctx = new FakeAudioContext();
      let resumeResolve!: () => void;
      ctx.resumeImpl = () =>
        new Promise<void>((resolve) => {
          resumeResolve = () => {
            ctx.state = 'running';
            resolve();
          };
        });
      // Expose resolver for the test via a side channel on the instance.
      (ctx as FakeAudioContext & { releaseResume: () => void }).releaseResume =
        () => resumeResolve();
      return ctx as unknown as AudioContext;
    };

    const player = new WebAudioGreetingPlayer({
      createAudioContext: ctxFactory,
    });

    // Force start() to throw on the silent unlock source.
    const originalCreate = FakeAudioContext.prototype.createBufferSource;
    FakeAudioContext.prototype.createBufferSource = function (
      this: FakeAudioContext,
    ) {
      const source = originalCreate.call(this);
      source.startError = new Error('autoplay blocked');
      return source;
    };
    try {
      player.activate();
      const ctx = FakeAudioContext.instances[0]! as FakeAudioContext & {
        releaseResume: () => void;
      };

      const readyPromise = player.ensureReady(new AbortController().signal);
      // Resume still pending — unlock already failed in-closure.
      ctx.releaseResume();
      await expect(readyPromise).resolves.toEqual({
        ok: false,
        reason: 'unlock_failed',
      });
    } finally {
      FakeAudioContext.prototype.createBufferSource = originalCreate;
    }
  });

  it('overlapping activations: newer unlock failure is not cleared by older resume success', async () => {
    let resumeResolvers: Array<() => void> = [];
    const ctxFactory = () => {
      const ctx = new FakeAudioContext();
      ctx.resumeImpl = () =>
        new Promise<void>((resolve) => {
          resumeResolvers.push(() => {
            ctx.state = 'running';
            resolve();
          });
        });
      return ctx as unknown as AudioContext;
    };

    const player = new WebAudioGreetingPlayer({
      createAudioContext: ctxFactory,
    });

    // First activation: unlock ok, resume hangs.
    player.activate();
    expect(resumeResolvers).toHaveLength(1);

    // Second activation: unlock fails via start throw, resume hangs separately.
    const originalCreate = FakeAudioContext.prototype.createBufferSource;
    FakeAudioContext.prototype.createBufferSource = function (
      this: FakeAudioContext,
    ) {
      const source = originalCreate.call(this);
      source.startError = new Error('second unlock failed');
      return source;
    };
    try {
      player.activate();
      expect(resumeResolvers).toHaveLength(2);

      // Resolve the older resume first — must not make readiness ok.
      resumeResolvers[0]!();
      await Promise.resolve();

      // Resolve the newer resume; outcome must remain unlock_failed.
      resumeResolvers[1]!();
      await expect(
        player.ensureReady(new AbortController().signal),
      ).resolves.toEqual({ ok: false, reason: 'unlock_failed' });
    } finally {
      FakeAudioContext.prototype.createBufferSource = originalCreate;
      resumeResolvers = [];
    }
  });
});
