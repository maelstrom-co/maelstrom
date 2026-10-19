import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getPcm16WavMetadata,
  type Pcm16WavMetadata,
} from './playback-observability.ts';
import {
  requireNonemptyFixtureVad,
  type VadValidation,
} from './single-turn-validity.ts';
import { trimPcm16Wav } from './trim-pcm16-wav.ts';

export type BargeInStimulus = {
  readonly path: string;
  readonly wav: Buffer;
  readonly metadata: Pcm16WavMetadata;
  readonly evidence: Pcm16WavMetadata & {
    readonly sha256: string;
    readonly transformation: 'prefix-before-first-source-vad-segment';
    readonly trimmedFrames: number;
    readonly trimmedMs: number;
  };
  readonly cleanup: () => Promise<void>;
};

export async function prepareBargeInStimulus(args: {
  readonly scenario: 'greeting' | 'task-response';
  readonly sourceWav: Buffer;
  readonly fixtureVad: VadValidation;
}): Promise<BargeInStimulus> {
  const sourceMetadata = getPcm16WavMetadata(args.sourceWav);
  const vad = requireNonemptyFixtureVad(args.fixtureVad, sourceMetadata);
  const trimmedFrames = vad.segments[0]?.startSample;
  if (trimmedFrames === undefined)
    throw new Error('Barge-in stimulus has no detected speech onset');
  // VAD offsets are source frames, not interleaved channel samples. No resampling.
  const wav = trimPcm16Wav(args.sourceWav, trimmedFrames);
  const metadata = getPcm16WavMetadata(wav);
  const evidence: BargeInStimulus['evidence'] = {
    ...metadata,
    sha256: createHash('sha256').update(wav).digest('hex'),
    transformation: 'prefix-before-first-source-vad-segment',
    trimmedFrames,
    trimmedMs: (trimmedFrames / sourceMetadata.sampleRate) * 1_000,
  };
  const directory = await mkdtemp(
    join(tmpdir(), `voice-${args.scenario}-stimulus-`),
  );
  const path = join(directory, 'open-calendar.wav');
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    await writeFile(path, wav, { mode: 0o600 });
  } catch (error) {
    await cleanup().catch(() => {});
    throw error;
  }
  return { path, wav, metadata, evidence, cleanup };
}
