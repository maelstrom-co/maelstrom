import { describe, expect, it } from 'bun:test';
import {
  projectPlayoutDiagnostic,
  WebRtcPlayoutDiagnostics,
} from './playout-diagnostics.js';

describe('WebRTC playout diagnostics', () => {
  it('projects bounded degradation categories without retaining raw fields', () => {
    const diagnostic = projectPlayoutDiagnostic(
      {
        packetsLost: 10,
        packetsReceived: 1_000,
        concealedSamples: 100,
        totalSamplesReceived: 10_000,
        insertedSamples: 20,
        removedSamples: 10,
        jitterBufferDelay: 2,
        jitterBufferEmittedCount: 100,
      },
      {
        packetsLost: 20,
        packetsReceived: 1_090,
        concealedSamples: 700,
        totalSamplesReceived: 20_000,
        insertedSamples: 120,
        removedSamples: 110,
        jitterBufferDelay: 8,
        jitterBufferEmittedCount: 200,
      },
    );

    expect(diagnostic).toEqual({
      category: 'webrtc-playout',
      availability: 'available',
      packetLoss: 'high',
      concealment: 'high',
      rateAdjustment: 'elevated',
      jitterBufferDelay: 'medium',
    });
    expect(JSON.stringify(diagnostic)).not.toContain('candidate');
  });

  it('emits unavailable without throwing when stats cannot be read', async () => {
    const diagnostics: unknown[] = [];
    const owner = new WebRtcPlayoutDiagnostics((value) =>
      diagnostics.push(value),
    );
    const connection = {
      getReceivers: () => [
        {
          track: { kind: 'audio' },
          getStats: async () => {
            throw new Error('private provider failure');
          },
        },
      ],
    } as unknown as RTCPeerConnection;

    owner.start(connection, 1);
    owner.finish(connection, 1);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(diagnostics).toEqual([
      {
        category: 'webrtc-playout',
        availability: 'unavailable',
        packetLoss: 'unavailable',
        concealment: 'unavailable',
        rateAdjustment: 'unavailable',
        jitterBufferDelay: 'unavailable',
      },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain(
      'private provider failure',
    );
  });

  it('drops a completed snapshot after teardown invalidates its epoch', async () => {
    const diagnostics: unknown[] = [];
    const releases: Array<(report: RTCStatsReport) => void> = [];
    const connection = {
      getReceivers: () => [
        {
          track: { kind: 'audio' },
          getStats: () =>
            new Promise<RTCStatsReport>((resolve) => releases.push(resolve)),
        },
      ],
    } as unknown as RTCPeerConnection;
    const owner = new WebRtcPlayoutDiagnostics((value) =>
      diagnostics.push(value),
    );

    owner.start(connection, 1);
    owner.finish(connection, 1);
    owner.clear();
    const report = new Map([
      [
        'audio',
        {
          type: 'inbound-rtp',
          kind: 'audio',
          packetsLost: 0,
          packetsReceived: 1,
        },
      ],
    ]) as unknown as RTCStatsReport;
    for (const release of releases) release(report);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(diagnostics).toEqual([]);
  });
});
