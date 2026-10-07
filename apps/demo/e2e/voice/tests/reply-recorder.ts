import { spawn } from 'node:child_process';

/** Linux/PulseAudio observer. It never routes playback into the microphone. */
export function recordReplies(source = 'tts2mic_rx.monitor') {
  const child = spawn(
    'parec',
    [
      `--device=${source}`,
      '--raw',
      '--format=s16le',
      '--rate=48000',
      '--channels=1',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const chunks: Buffer[] = [];
  let bytes = 0,
    stderr = '',
    closed = false,
    stopping = false;
  let problem: Error | undefined;

  child.stdout.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > 48_000 * 2 * 125) {
      problem ??= new Error('Reply recording exceeded its 125-second limit');
      child.kill('SIGTERM');
      return;
    }
    chunks.push(chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4096);
  });
  child.on('error', (error) => {
    problem = error;
  });
  const ended = new Promise<void>((resolve) => {
    child.once('close', (code, signal) => {
      closed = true;
      if (!stopping) {
        problem ??= new Error(
          `parec exited unexpectedly (${code ?? signal}): ${stderr}`,
        );
      }
      resolve();
    });
  });

  return {
    check() {
      if (problem) throw problem;
    },
    // Always expose buffered data, even on failure, for diagnostics.
    pcm(offset = 0) {
      if (offset < 0 || offset % 2)
        throw new Error('PCM offset must be nonnegative and sample-aligned');
      const data = Buffer.concat(chunks);
      return data.subarray(offset, data.length - (data.length % 2));
    },
    diagnostics() {
      return stderr;
    },
    async stop() {
      if (closed) return;
      stopping = true;
      child.kill('SIGINT');
      const killer = setTimeout(() => child.kill('SIGKILL'), 1500);
      killer.unref();
      try {
        await ended;
      } finally {
        clearTimeout(killer);
      }
    },
  };
}

/** Non-silence only: not STT, intelligibility, or proof of a correct spoken reply. */
export function nonSilentMs(pcm: Buffer, threshold = 0.01): number {
  const frameSamples = 480; // 10 ms at the recorder's fixed 48 kHz.
  let activeFrames = 0;
  for (
    let offset = 0;
    offset + frameSamples * 2 <= pcm.length;
    offset += frameSamples * 2
  ) {
    let energy = 0;
    for (let i = 0; i < frameSamples; i++) {
      const sample = pcm.readInt16LE(offset + i * 2) / 32768;
      energy += sample * sample;
    }
    if (Math.sqrt(energy / frameSamples) > threshold) activeFrames++;
  }
  return activeFrames * 10;
}

/** Duration of the quiet tail after the last non-silent 10 ms audio frame. */
export function silentTailMs(pcm: Buffer, threshold = 0.01): number {
  const frameSamples = 480;
  const frameBytes = frameSamples * 2;
  const completeFrames = Math.floor(pcm.length / frameBytes);
  let lastActiveFrame = -1;
  for (let frame = 0; frame < completeFrames; frame++) {
    let energy = 0;
    const start = frame * frameBytes;
    for (let sample = 0; sample < frameSamples; sample++) {
      const value = pcm.readInt16LE(start + sample * 2) / 32768;
      energy += value * value;
    }
    if (Math.sqrt(energy / frameSamples) > threshold) lastActiveFrame = frame;
  }
  return Math.max(0, completeFrames - lastActiveFrame - 1) * 10;
}

/** Wrap the recorder's mono little-endian PCM16 samples in a WAV header. */
export function replyWav(pcm: Buffer): Buffer {
  pcm = pcm.subarray(0, pcm.length - (pcm.length % 2));
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24);
  wav.writeUInt32LE(96000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
}
