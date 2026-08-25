type Severity = 'none' | 'low' | 'elevated' | 'high' | 'unavailable';

interface PlayoutSnapshot {
  readonly packetsLost?: number;
  readonly packetsReceived?: number;
  readonly concealedSamples?: number;
  readonly totalSamplesReceived?: number;
  readonly insertedSamples?: number;
  readonly removedSamples?: number;
  readonly jitterBufferDelay?: number;
  readonly jitterBufferEmittedCount?: number;
}

export interface PlayoutDiagnostic {
  readonly category: 'webrtc-playout';
  readonly availability: 'available' | 'partial' | 'unavailable';
  readonly packetLoss: Severity;
  readonly concealment: Severity;
  readonly rateAdjustment: Severity;
  readonly jitterBufferDelay: 'low' | 'medium' | 'high' | 'unavailable';
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function delta(after: number | undefined, before: number | undefined) {
  if (after === undefined || before === undefined || after < before) return;
  return after - before;
}

function ratioSeverity(
  numerator: number | undefined,
  denominator: number | undefined,
): Severity {
  if (numerator === undefined || denominator === undefined || denominator <= 0)
    return 'unavailable';
  const ratio = numerator / denominator;
  if (ratio === 0) return 'none';
  if (ratio <= 0.01) return 'low';
  if (ratio <= 0.05) return 'elevated';
  return 'high';
}

export function projectPlayoutDiagnostic(
  before: PlayoutSnapshot | undefined,
  after: PlayoutSnapshot | undefined,
): PlayoutDiagnostic {
  if (!before || !after) {
    return {
      category: 'webrtc-playout',
      availability: 'unavailable',
      packetLoss: 'unavailable',
      concealment: 'unavailable',
      rateAdjustment: 'unavailable',
      jitterBufferDelay: 'unavailable',
    };
  }

  const received = delta(after.packetsReceived, before.packetsReceived);
  const lost = delta(after.packetsLost, before.packetsLost);
  const samples = delta(
    after.totalSamplesReceived,
    before.totalSamplesReceived,
  );
  const concealed = delta(after.concealedSamples, before.concealedSamples);
  const inserted = delta(after.insertedSamples, before.insertedSamples);
  const removed = delta(after.removedSamples, before.removedSamples);
  const jitterDelay = delta(after.jitterBufferDelay, before.jitterBufferDelay);
  const jitterCount = delta(
    after.jitterBufferEmittedCount,
    before.jitterBufferEmittedCount,
  );
  const packetLoss = ratioSeverity(lost, (received ?? 0) + (lost ?? 0));
  const concealment = ratioSeverity(concealed, samples);
  const rateAdjustment = ratioSeverity(
    inserted === undefined || removed === undefined
      ? undefined
      : inserted + removed,
    samples,
  );
  const meanJitter =
    jitterDelay !== undefined && jitterCount !== undefined && jitterCount > 0
      ? jitterDelay / jitterCount
      : undefined;
  const jitterBufferDelay =
    meanJitter === undefined
      ? 'unavailable'
      : meanJitter <= 0.03
        ? 'low'
        : meanJitter <= 0.1
          ? 'medium'
          : 'high';
  const values = [packetLoss, concealment, rateAdjustment, jitterBufferDelay];
  const available = values.filter((value) => value !== 'unavailable').length;
  return {
    category: 'webrtc-playout',
    availability:
      available === 0
        ? 'unavailable'
        : available === values.length
          ? 'available'
          : 'partial',
    packetLoss,
    concealment,
    rateAdjustment,
    jitterBufferDelay,
  };
}

async function readSnapshot(
  connection: RTCPeerConnection,
): Promise<PlayoutSnapshot | undefined> {
  try {
    const receiver = connection
      .getReceivers()
      .find((candidate) => candidate.track?.kind === 'audio');
    if (!receiver) return;
    const report = await receiver.getStats();
    let inbound: Record<string, unknown> | undefined;
    report.forEach((candidate) => {
      const record = candidate as unknown as Record<string, unknown>;
      if (
        record.type === 'inbound-rtp' &&
        (record.kind === 'audio' || record.mediaType === 'audio')
      ) {
        inbound = record;
      }
    });
    if (!inbound) return;
    return {
      packetsLost: finite(inbound.packetsLost),
      packetsReceived: finite(inbound.packetsReceived),
      concealedSamples: finite(inbound.concealedSamples),
      totalSamplesReceived: finite(inbound.totalSamplesReceived),
      insertedSamples: finite(inbound.insertedSamplesForDeceleration),
      removedSamples: finite(inbound.removedSamplesForAcceleration),
      jitterBufferDelay: finite(inbound.jitterBufferDelay),
      jitterBufferEmittedCount: finite(inbound.jitterBufferEmittedCount),
    };
  } catch {
    return;
  }
}

/** Debug-only owner of one bounded diagnostic per current output interval. */
export class WebRtcPlayoutDiagnostics {
  readonly #emit: (diagnostic: PlayoutDiagnostic) => void;
  #active:
    | {
        readonly connection: RTCPeerConnection;
        readonly generation: number;
        readonly epoch: number;
        readonly before: Promise<PlayoutSnapshot | undefined>;
      }
    | undefined;
  #epoch = 0;

  constructor(emit: (diagnostic: PlayoutDiagnostic) => void) {
    this.#emit = emit;
  }

  start(connection: RTCPeerConnection, generation: number): void {
    this.#epoch += 1;
    this.#active = {
      connection,
      generation,
      epoch: this.#epoch,
      before: readSnapshot(connection),
    };
  }

  finish(connection: RTCPeerConnection, generation: number): void {
    const active = this.#active;
    if (
      !active ||
      active.connection !== connection ||
      active.generation !== generation
    )
      return;
    this.#active = undefined;
    void Promise.all([active.before, readSnapshot(connection)]).then(
      ([before, after]) => {
        if (active.epoch !== this.#epoch) return;
        this.#emit(projectPlayoutDiagnostic(before, after));
      },
      () => {},
    );
  }

  clear(): void {
    this.#epoch += 1;
    this.#active = undefined;
  }
}
