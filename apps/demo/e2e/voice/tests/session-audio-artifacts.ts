import type { BrowserAudioTimelineSnapshot } from './shared-audio-capture.ts';

export type SessionAudioArtifact = {
  readonly name: string;
  readonly body: Buffer;
  readonly contentType: 'audio/wav';
};

function wavInfo(wav: Buffer) {
  if (
    wav.toString('ascii', 0, 4) !== 'RIFF' ||
    wav.toString('ascii', 8, 12) !== 'WAVE'
  )
    throw new Error('Shared audio timeline capture was not a RIFF/WAVE file');
  if (
    wav.toString('ascii', 12, 16) !== 'fmt ' ||
    wav.toString('ascii', 36, 40) !== 'data'
  )
    throw new Error(
      'Shared audio timeline capture has an unexpected WAV layout',
    );
  const channels = wav.readUInt16LE(22);
  const sampleRate = wav.readUInt32LE(24);
  const frames = wav.readUInt32LE(40) / (2 * channels);
  return { channels, sampleRate, frames };
}

export function sessionAudioArtifacts(
  snapshot: BrowserAudioTimelineSnapshot,
): readonly SessionAudioArtifact[] {
  const input = Buffer.from(snapshot.inputWavBase64, 'base64');
  const assistant = Buffer.from(snapshot.assistantWavBase64, 'base64');
  const inputInfo = wavInfo(input);
  const assistantInfo = wavInfo(assistant);
  const expectedFrames = snapshot.endFrame - snapshot.startFrame;
  if (
    snapshot.sampleRate !== 48_000 ||
    inputInfo.sampleRate !== snapshot.sampleRate ||
    assistantInfo.sampleRate !== snapshot.sampleRate ||
    inputInfo.frames !== expectedFrames ||
    assistantInfo.frames !== expectedFrames ||
    inputInfo.frames !== assistantInfo.frames
  )
    throw new Error(
      'Shared session audio WAVs do not share the captured sample rate and frame timeline',
    );
  if (snapshot.missingBlocks > 0)
    throw new Error(
      `Shared session audio has ${snapshot.missingBlocks} missing or format-changing blocks`,
    );

  return [
    {
      name: 'voice-session-human-input-audioworklet.wav',
      body: input,
      contentType: 'audio/wav',
    },
    {
      name: 'voice-session-assistant-rendered-audioworklet.wav',
      body: assistant,
      contentType: 'audio/wav',
    },
  ];
}
