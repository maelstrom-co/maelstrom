const INPUT_SAMPLE_RATE = 16000;

let cachedStream: MediaStream | null = null;
let cachedAudioContext: AudioContext | null = null;

export interface AudioSetup {
  stream: MediaStream;
  audioContext: AudioContext;
}

function isStreamValid(stream: MediaStream | null): boolean {
  if (!stream?.active) return false;
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) return false;
  return audioTracks.every((track) => track.readyState === 'live');
}

function isContextValid(ctx: AudioContext | null): boolean {
  return ctx !== null && ctx.state !== 'closed';
}

export async function requestMicrophoneAccess(): Promise<AudioSetup> {
  if (
    isStreamValid(cachedStream) &&
    isContextValid(cachedAudioContext) &&
    cachedAudioContext
  ) {
    if (cachedAudioContext.state === 'suspended') {
      await cachedAudioContext.resume();
    }
    return {
      stream: cachedStream as MediaStream,
      audioContext: cachedAudioContext,
    };
  }

  clearCachedAudioSetup();

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      sampleRate: INPUT_SAMPLE_RATE,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  const audioContext = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });

  cachedStream = stream;
  cachedAudioContext = audioContext;

  return { stream, audioContext };
}

export function getCachedAudioSetup(): AudioSetup | null {
  if (
    isStreamValid(cachedStream) &&
    isContextValid(cachedAudioContext) &&
    cachedAudioContext
  ) {
    return {
      stream: cachedStream as MediaStream,
      audioContext: cachedAudioContext,
    };
  }
  return null;
}

export function clearCachedAudioSetup(): void {
  if (cachedStream) {
    cachedStream.getTracks().forEach((track) => {
      track.stop();
    });
    cachedStream = null;
  }
  if (cachedAudioContext && cachedAudioContext.state !== 'closed') {
    cachedAudioContext.close().catch(() => {});
    cachedAudioContext = null;
  }
}
