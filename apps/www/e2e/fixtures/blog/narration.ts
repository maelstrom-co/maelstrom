import type { NarrationStore } from '../../../tools/blog-narration-publication';

export function memoryStore(
  objects = new Map<string, string>(),
): NarrationStore {
  return {
    async get(key) {
      return objects.get(key);
    },
    async readVersioned(key) {
      const value = objects.get(key);
      return value === undefined ? undefined : { value, etag: value };
    },
    async compareAndSet(key, value, etag) {
      if (objects.get(key) !== etag) return false;
      objects.set(key, value);
      return true;
    },
    async put(key, value) {
      if (objects.has(key)) throw new Error('Unexpected overwrite');
      objects.set(key, value);
    },
  };
}

export const mockSecret = 'narration-fixture-secret';

export async function fixtureSpeech(url: string, init: RequestInit) {
  if (
    !url.startsWith(
      'https://api.elevenlabs.io/v1/text-to-speech/myvoice/with-timestamps?',
    ) ||
    new Headers(init.headers).get('xi-api-key') !== mockSecret
  )
    throw new Error('Unexpected provider request');
  const { text } = JSON.parse(String(init.body)) as { text: string };
  const characters = [...text];
  const duration = characters.length * 0.085 + 0.25;
  const samples = Math.ceil(16_000 * duration);
  const pcm = Buffer.alloc(samples * 2);
  for (let sample = 0; sample < samples; sample++) {
    pcm.writeInt16LE(
      Math.round(100 * Math.sin((2 * Math.PI * 440 * sample) / 16_000)),
      sample * 2,
    );
  }
  return Response.json({
    audio_base64: pcm.toString('base64'),
    alignment: {
      characters,
      character_start_times_seconds: characters.map(
        (_, index) => index * 0.085,
      ),
      character_end_times_seconds: characters.map(
        (_, index) => index * 0.085 + 0.06,
      ),
    },
    normalized_alignment: {
      characters: ['different normalized words'],
      character_start_times_seconds: [0],
      character_end_times_seconds: [1],
    },
  });
}
