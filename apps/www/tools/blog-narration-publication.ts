import { glob, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { Window } from 'happy-dom';

import {
  extractNarration,
  narrationDigest,
  narrationMediaPath,
  narrationVersion,
  validateManifest,
  validateTiming,
  type NarrationChunk,
  type NarrationManifest,
  type WordTiming,
} from '../src/lib/blog-narration';

const synthesis = {
  model_id: 'eleven_multilingual_v2',
  apply_text_normalization: 'auto',
};
const format = 'pcm_16000';
const sampleRate = 16_000;
const chunkLimit = 3_000;
const maxAssetBytes = 25 * 1024 * 1024;

export interface NarrationStore {
  get(key: string): Promise<string | undefined>;
  put(key: string, value: string): Promise<void>;
}

export interface NarrationPublication {
  store: NarrationStore;
  voiceId: string;
  voiceRevision: string;
  apiKey: string;
  request?: (url: string, init: RequestInit) => Promise<Response>;
  limit?: number;
  beforeSynthesis?: (characters: number) => Promise<void>;
}

interface SourceChunk {
  text: string;
  offset: number;
  words: { from: number; to: number }[];
}

export function splitNarration(
  text: string,
  limit = chunkLimit,
): SourceChunk[] {
  if (!Number.isSafeInteger(limit) || limit < 2 || limit > chunkLimit) {
    throw new Error('Invalid narration chunk limit');
  }
  const segmenter = new Intl.Segmenter('en', { granularity: 'word' });
  const words = Array.from(
    segmenter.segment(text),
    ({ segment, index, isWordLike }) =>
      isWordLike ? { from: index, to: index + segment.length } : undefined,
  ).filter((word) => word !== undefined);

  const chunks: SourceChunk[] = [];
  let offset = 0;
  let wordIndex = 0;
  while (offset < text.length) {
    let end = Math.min(text.length, offset + limit);
    if (end < text.length) {
      const slice = text.slice(offset, end);
      const paragraph = slice.lastIndexOf('\n\n');
      const sentence = Array.from(slice.matchAll(/[.!?][ \n]+/gu)).at(-1);
      const boundary = sentence ? sentence.index + sentence[0].length : 0;
      const whitespace =
        Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\n')) + 1;
      const floor = Math.floor(limit / 2);
      const split = [
        paragraph < 0 ? 0 : paragraph + 2,
        boundary,
        whitespace,
      ].find((point) => point > floor);
      if (split) {
        end = offset + split;
      } else {
        let candidate = wordIndex;
        while (words[candidate]?.to <= end) candidate++;
        const crossingWord = words[candidate];
        if (
          crossingWord &&
          crossingWord.from > offset &&
          crossingWord.from < end
        ) {
          end = crossingWord.from;
        } else if (/[\uDC00-\uDFFF]/u.test(text[end])) {
          end--;
        }
      }
    }
    const intersections: SourceChunk['words'] = [];
    while (wordIndex < words.length && words[wordIndex].from < end) {
      const word = words[wordIndex];
      intersections.push({
        from: Math.max(offset, word.from),
        to: Math.min(end, word.to),
      });
      if (word.to > end) break;
      wordIndex++;
    }
    chunks.push({
      text: text.slice(offset, end),
      offset,
      words: intersections,
    });
    offset = end;
  }
  return chunks;
}

export function parseNarrationHtml(html: string): Document {
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
      fetch: {
        interceptor: {
          beforeAsyncRequest: async ({ window }) =>
            new window.Response(null, { status: 403 }),
          beforeSyncRequest: ({ window }) => ({
            status: 403,
            statusText: 'Forbidden',
            ok: false,
            url: '',
            redirected: false,
            headers: new window.Headers(),
            body: null,
          }),
        },
      },
    },
  });
  return new window.DOMParser().parseFromString(
    html,
    'text/html',
  ) as unknown as Document;
}

function toWave(pcm: Uint8Array) {
  if (pcm.length === 0 || pcm.length % 2 || pcm.length + 44 > maxAssetBytes) {
    throw new Error('Invalid narration PCM size');
  }
  const file = new Uint8Array(pcm.length + 44);
  const encoder = new TextEncoder();
  file.set(encoder.encode('RIFF'), 0);
  file.set(encoder.encode('WAVEfmt '), 8);
  file.set(encoder.encode('data'), 36);
  const view = new DataView(file.buffer);
  view.setUint32(4, file.length - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, pcm.length, true);
  file.set(pcm, 44);
  return file;
}

function decodeAudio(encoded: unknown) {
  if (
    typeof encoded !== 'string' ||
    encoded.length > Math.ceil(maxAssetBytes / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded) ||
    encoded.length % 4
  )
    throw new Error('Invalid narration audio encoding');
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

function align(
  source: SourceChunk,
  alignment: unknown,
  duration: number,
): WordTiming[] {
  if (!alignment || typeof alignment !== 'object')
    throw new Error('Missing original narration alignment');
  const {
    characters,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  } = alignment as Record<string, unknown>;
  if (
    !Array.isArray(characters) ||
    !Array.isArray(starts) ||
    !Array.isArray(ends) ||
    starts.length !== characters.length ||
    ends.length !== characters.length ||
    !characters.every(
      (character) => typeof character === 'string' && character.length > 0,
    ) ||
    characters.join('') !== source.text
  )
    throw new Error('Narration alignment does not match the source text');

  const characterIndex: number[] = [];
  for (const [index, character] of characters.entries()) {
    const start = starts[index];
    const end = ends[index];
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < (starts[index - 1] ?? 0) ||
      end < (ends[index - 1] ?? 0) ||
      end < start ||
      end > duration + 0.03
    )
      throw new Error('Invalid narration character timing');
    for (let offset = 0; offset < character.length; offset++)
      characterIndex.push(index);
  }

  const timings = source.words.map(({ from, to }) => ({
    from,
    to,
    start: starts[characterIndex[from - source.offset]] as number,
    end: Math.min(duration, ends[characterIndex[to - source.offset - 1]]),
  }));
  for (const [index, word] of timings.entries()) {
    const next = timings[index + 1];
    if (next) word.end = Math.min(word.end, next.start);
  }
  return timings;
}

async function synthesize(source: SourceChunk, options: NarrationPublication) {
  await options.beforeSynthesis?.(source.text.length);
  const response = await (options.request ?? fetch)(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(options.voiceId)}/with-timestamps?output_format=${format}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': options.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ...synthesis, text: source.text }),
      redirect: 'error',
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok)
    throw new Error(`Narration provider returned HTTP ${response.status}`);
  const { audio_base64: audio, alignment } = (await response.json()) as Record<
    string,
    unknown
  >;
  const pcm = decodeAudio(audio);
  const media = toWave(pcm);
  const duration = pcm.length / (sampleRate * 2);
  const timing: NarrationChunk = {
    duration,
    sha256: await narrationDigest(media),
    words: align(source, alignment, duration),
  };
  return { timing, audio };
}

async function cachedChunk(
  source: SourceChunk,
  text: string,
  key: string,
  maySynthesize: boolean,
  options: NarrationPublication,
) {
  const stored = await options.store.get(key);
  if (stored === undefined && !maySynthesize)
    throw new Error('Committed narration is missing audio');
  const chunk: { timing: unknown; audio: unknown } =
    stored === undefined
      ? await synthesize(source, options)
      : JSON.parse(stored);
  const media = toWave(decodeAudio(chunk.audio));
  const { timing } = chunk;
  if (
    !validateTiming(timing, text) ||
    timing.duration !== (media.length - 44) / (sampleRate * 2) ||
    timing.sha256 !== (await narrationDigest(media))
  )
    throw new Error('Invalid cached narration chunk');
  if (
    timing.words.length !== source.words.length ||
    timing.words.some(
      ({ from, to }, index) =>
        from !== source.words[index].from || to !== source.words[index].to,
    )
  ) {
    throw new Error('Narration word offsets do not match this chunk');
  }
  if (stored === undefined) await options.store.put(key, JSON.stringify(chunk));
  return { timing, media };
}

async function writeAsset(file: string, value: string | Uint8Array) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, value);
  await rename(temporary, file);
}

interface NarrationDestination {
  writeAudio: (path: string, media: Uint8Array) => Promise<void>;
  writeManifest: (manifest: string) => Promise<void>;
}

export async function publishNarrationArticle(
  text: string,
  options: NarrationPublication,
  destination: NarrationDestination,
) {
  const textHash = await narrationDigest(text);
  const limit = options.limit ?? chunkLimit;
  const version = await narrationDigest(
    JSON.stringify({
      textHash,
      algorithm: narrationVersion,
      synthesis,
      format,
      limit,
      voiceId: options.voiceId,
      voiceRevision: options.voiceRevision,
    }),
  );
  const prefix = `blog-narration/${version}`;
  const manifestKey = `${prefix}/manifest.json`;
  const previous = await options.store.get(manifestKey);
  const sources = splitNarration(text, limit);
  const manifest: NarrationManifest = { version, textHash, chunks: [] };
  for (const [index, source] of sources.entries()) {
    const { timing, media } = await cachedChunk(
      source,
      text,
      `${prefix}/${index}.json`,
      previous === undefined,
      options,
    );
    manifest.chunks.push(timing);
    await destination.writeAudio(narrationMediaPath(version, index), media);
  }
  const manifestJson = JSON.stringify(manifest);
  if (
    !validateManifest(manifest, text) ||
    Buffer.byteLength(manifestJson) > maxAssetBytes
  ) {
    throw new Error('Invalid narration manifest');
  }
  if (previous !== undefined && previous !== manifestJson) {
    throw new Error('Committed narration does not match its cached chunks');
  }
  if (previous === undefined)
    await options.store.put(manifestKey, manifestJson);
  await destination.writeManifest(manifestJson);
}

export async function publishNarration(
  output: string,
  options: NarrationPublication,
) {
  const failures: string[] = [];
  for await (const article of glob('*/index.html', {
    cwd: join(output, 'blog'),
  })) {
    try {
      const page = join(output, 'blog', article);
      const document = parseNarrationHtml(await readFile(page, 'utf8'));
      const { text } = extractNarration(document);
      if (!text) throw new Error('Missing narration text');
      await publishNarrationArticle(text, options, {
        writeAudio: (path, media) => writeAsset(join(output, path), media),
        writeManifest: (manifest) =>
          writeAsset(join(dirname(page), 'narration.json'), manifest),
      });
    } catch (error) {
      failures.push(
        `${dirname(article)}: ${error instanceof Error ? error.message : 'Narration failed'}`,
      );
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));
}
