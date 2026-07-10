import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { TokenHandshakeResponse, UnixSeconds } from '@maelstrom-co/protocol';

import type { AdapterConnectOptions } from '../realtime-session/provider-adapter.types.js';
import { OpenAIAdapter } from './openai-adapter.js';

// ============================================================================
// Fakes
// ============================================================================

class FakeTrack {
  stopped = false;
  stop(): void {
    this.stopped = true;
  }
}

class FakeMediaStream {
  static instances: FakeMediaStream[] = [];
  readonly tracks: FakeTrack[];

  constructor(trackCount = 1) {
    this.tracks = Array.from({ length: trackCount }, () => new FakeTrack());
    FakeMediaStream.instances.push(this);
  }

  getTracks(): FakeTrack[] {
    return this.tracks;
  }
}

class FakeDataChannel {
  readonly sent: string[] = [];
  closed = false;
  readyState = 'connecting';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 'closed';
  }

  triggerOpen(): void {
    this.readyState = 'open';
    this.onopen?.();
  }
}

interface FakeSender {
  track: FakeTrack | null;
}

class FakeRTCPeerConnection {
  static instances: FakeRTCPeerConnection[] = [];

  closed = false;
  ontrack: ((event: { streams: unknown[] }) => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  iceConnectionState = 'new';
  localDescription: { type: string; sdp: string } | undefined;
  dataChannel: FakeDataChannel | undefined;
  private readonly senders: FakeSender[] = [];

  constructor() {
    FakeRTCPeerConnection.instances.push(this);
  }

  createDataChannel(_label: string): FakeDataChannel {
    this.dataChannel = new FakeDataChannel();
    return this.dataChannel;
  }

  addTrack(track: FakeTrack): FakeSender {
    const sender: FakeSender = { track };
    this.senders.push(sender);
    return sender;
  }

  getSenders(): FakeSender[] {
    return this.senders;
  }

  async createOffer(): Promise<{ type: string; sdp: string }> {
    return { type: 'offer', sdp: 'fake-offer-sdp' };
  }

  async setLocalDescription(desc: {
    type: string;
    sdp: string;
  }): Promise<void> {
    this.localDescription = desc;
  }

  async setRemoteDescription(_desc: {
    type: string;
    sdp: string;
  }): Promise<void> {}

  close(): void {
    this.closed = true;
  }
}

class FakeAudio {
  autoplay = false;
  srcObject: unknown = null;
}

// ============================================================================
// Harness
// ============================================================================

const fakeToken: TokenHandshakeResponse = {
  provider: 'openai',
  value: 'ek-test-secret',
  expiresAt: (Math.floor(Date.now() / 1000) + 60) as UnixSeconds,
  model: 'gpt-realtime',
};

const connectOpts: AdapterConnectOptions = {
  tools: [
    {
      name: 'get_ui_state',
      description: 'reads UI state',
      parametersJsonSchema: {},
    },
  ],
  instructions: 'be helpful',
};

let getUserMediaImpl: () => Promise<FakeMediaStream>;
let fetchImpl: () => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

let originalRTCPeerConnection: unknown;
let originalAudio: unknown;
let originalFetch: unknown;
let originalNavigator: PropertyDescriptor | undefined;

function restoreGlobal(key: string, original: unknown): void {
  if (original === undefined) {
    Reflect.deleteProperty(globalThis, key);
  } else {
    Object.defineProperty(globalThis, key, {
      value: original,
      configurable: true,
      writable: true,
    });
  }
}

beforeEach(() => {
  FakeRTCPeerConnection.instances = [];
  FakeMediaStream.instances = [];
  getUserMediaImpl = async () => new FakeMediaStream(1);
  fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => 'fake-answer-sdp',
  });

  originalRTCPeerConnection = Reflect.get(globalThis, 'RTCPeerConnection');
  originalAudio = Reflect.get(globalThis, 'Audio');
  originalFetch = Reflect.get(globalThis, 'fetch');
  originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  Object.defineProperty(globalThis, 'RTCPeerConnection', {
    value: FakeRTCPeerConnection,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'Audio', {
    value: FakeAudio,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'fetch', {
    value: (..._args: unknown[]) => fetchImpl(),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices: { getUserMedia: () => getUserMediaImpl() } },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  restoreGlobal('RTCPeerConnection', originalRTCPeerConnection);
  restoreGlobal('Audio', originalAudio);
  restoreGlobal('fetch', originalFetch);
  if (originalNavigator) {
    Object.defineProperty(globalThis, 'navigator', originalNavigator);
  } else {
    Reflect.deleteProperty(globalThis, 'navigator');
  }
});

// ============================================================================
// Mint failure
// ============================================================================

describe('OpenAIAdapter — mintToken failure', () => {
  it('rejects connect without constructing an RTCPeerConnection, and resets the connecting guard for a clean retry', async () => {
    let attempt = 0;
    const adapter = new OpenAIAdapter({
      mintToken: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('mint failed');
        return fakeToken;
      },
    });

    await expect(adapter.connect(connectOpts)).rejects.toThrow('mint failed');
    expect(FakeRTCPeerConnection.instances).toHaveLength(0);

    // The `connecting` guard must have been reset by teardown() — otherwise
    // this retry would spuriously hit the "already connected" guard.
    await adapter.connect(connectOpts);
    expect(FakeRTCPeerConnection.instances).toHaveLength(1);
  });
});

// ============================================================================
// getUserMedia failure
// ============================================================================

describe('OpenAIAdapter — getUserMedia failure', () => {
  it('rejects connect, closes the peer connection, and resets the connecting guard for a clean retry', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    getUserMediaImpl = async () => {
      throw new Error('mic denied');
    };

    await expect(adapter.connect(connectOpts)).rejects.toThrow('mic denied');
    expect(FakeRTCPeerConnection.instances).toHaveLength(1);
    expect(FakeRTCPeerConnection.instances[0]?.closed).toBe(true);

    getUserMediaImpl = async () => new FakeMediaStream(1);
    await adapter.connect(connectOpts);
    expect(FakeRTCPeerConnection.instances).toHaveLength(2);
    expect(FakeRTCPeerConnection.instances[1]?.closed).toBe(false);
  });
});

// ============================================================================
// Failed SDP exchange
// ============================================================================

describe('OpenAIAdapter — failed SDP exchange', () => {
  it('rejects connect and tears down mic tracks, data channel, and peer connection', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    fetchImpl = async () => ({ ok: false, status: 500, text: async () => '' });

    await expect(adapter.connect(connectOpts)).rejects.toThrow('status 500');

    const pc = FakeRTCPeerConnection.instances[0];
    const stream = FakeMediaStream.instances[0];
    expect(pc?.closed).toBe(true);
    expect(pc?.dataChannel?.closed).toBe(true);
    expect(stream?.tracks.every((track) => track.stopped)).toBe(true);
  });
});

// ============================================================================
// Double connect during mint
// ============================================================================

describe('OpenAIAdapter — double connect during mint', () => {
  it('rejects a second connect() started while the first is still awaiting mintToken, and only one RTCPeerConnection/mic stream ever exists', async () => {
    let resolveMint!: (token: TokenHandshakeResponse) => void;
    const mintPromise = new Promise<TokenHandshakeResponse>((resolve) => {
      resolveMint = resolve;
    });
    const adapter = new OpenAIAdapter({ mintToken: () => mintPromise });

    const first = adapter.connect(connectOpts);
    await expect(adapter.connect(connectOpts)).rejects.toThrow(
      'already connected',
    );

    resolveMint(fakeToken);
    await first;

    expect(FakeRTCPeerConnection.instances).toHaveLength(1);
    expect(FakeMediaStream.instances).toHaveLength(1);
  });
});

// ============================================================================
// Droppable grounding vs. error-worthy tool results on a closed channel
// ============================================================================

describe('OpenAIAdapter — closed data channel', () => {
  it('injectGrounding on a non-open channel drops silently, without emitting an error or sending anything', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    await adapter.connect(connectOpts);
    // Data channel never opened (triggerOpen() not called) — readyState stays 'connecting'.
    const pc = FakeRTCPeerConnection.instances[0];
    const dc = pc?.dataChannel;
    expect(dc?.readyState).toBe('connecting');

    const events: unknown[] = [];
    adapter.on((event) => events.push(event));

    adapter.injectGrounding('4 vessels on screen');

    expect(events).toEqual([]); // no error emitted — grounding is droppable
    expect(dc?.sent).toEqual([]); // nothing sent on the closed channel
  });

  it('sendToolResult on a non-open channel still emits an error', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    await adapter.connect(connectOpts);
    const pc = FakeRTCPeerConnection.instances[0];
    const dc = pc?.dataChannel;
    expect(dc?.readyState).toBe('connecting');

    const events: Array<{ type: string; error?: unknown }> = [];
    adapter.on((event) => events.push(event as { type: string; error?: unknown }));

    await adapter.sendToolResult('call-1', { ok: true, summary: 'done' });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('error');
    expect((events[0]?.error as Error)?.message).toContain('data channel not open');
  });
});

// ============================================================================
// Successful connect then disconnect
// ============================================================================

describe('OpenAIAdapter — successful connect then disconnect', () => {
  it('sends session.update with tools and instructions on channel open, then disconnect tears everything down', async () => {
    const adapter = new OpenAIAdapter({ mintToken: async () => fakeToken });
    await adapter.connect(connectOpts);

    const pc = FakeRTCPeerConnection.instances[0];
    const dc = pc?.dataChannel;
    expect(dc).toBeDefined();
    dc?.triggerOpen();

    expect(dc?.sent).toHaveLength(1);
    const sessionUpdate = JSON.parse(dc?.sent[0] ?? '{}');
    expect(sessionUpdate.type).toBe('session.update');
    expect(sessionUpdate.session.tools).toEqual([
      {
        type: 'function',
        name: 'get_ui_state',
        description: 'reads UI state',
        parameters: {},
      },
    ]);
    expect(sessionUpdate.session.instructions).toBe('be helpful');

    await adapter.disconnect();

    const stream = FakeMediaStream.instances[0];
    expect(stream?.tracks.every((track) => track.stopped)).toBe(true);
    expect(pc?.closed).toBe(true);
    expect(dc?.closed).toBe(true);
  });
});
