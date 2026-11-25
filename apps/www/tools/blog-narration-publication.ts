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
import {
  fencedSpeech,
  NarrationAttemptUnavailable,
  type NarrationStore,
} from './blog-narration-attempt';

const synthesis = {
  model_id: 'eleven_multilingual_v2',
  apply_text_normalization: 'auto',
};
const format = 'pcm_16000';
const sampleRate = 16_000;
const chunkLimit = 3_000;
const maxAssetBytes = 25 * 1024 * 1024;

export type { NarrationStore } from './blog-narration-attempt';
export { NarrationAttemptUnavailable } from './blog-narration-attempt';

export interface NarrationPublication {
  store: NarrationStore;
  voiceId: string;
  voiceRevision: string;
  apiKey: string;
  request?: (url: string, init: RequestInit) => Promise<Response>;
  limit?: number;
  beforeSynthesis?: (characters: number) => Promise<void>;
  beforeSend?: () => Promise<void>;
  now?: () => number;
  legacyText?: string;
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

function speechRequest(source: SourceChunk, options: NarrationPublication) {
  return (options.request ?? fetch)(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(options.voiceId)}/with-timestamps?output_format=${format}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': options.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ...synthesis, text: source.text }),
      redirect: 'error',
      keepalive: false,
      signal: AbortSignal.timeout(120_000),
    },
  );
}

async function decodeResponse(source: SourceChunk, raw: string) {
  const { audio_base64: audio, alignment } = JSON.parse(raw) as Record<
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
  version: string,
  index: number,
  maySynthesize: boolean,
  options: NarrationPublication,
) {
  const key = `blog-narration/${version}/${index}.json`;
  const stored = await options.store.get(key);
  if (stored === undefined && !maySynthesize)
    throw new Error('Committed narration is missing audio');
  const validateChunk = async (chunk: { timing: unknown; audio: unknown }) => {
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
    return {
      timing: {
        duration: timing.duration,
        sha256: timing.sha256,
        words: timing.words.map(({ from, to, start, end }) => ({
          from,
          to,
          start,
          end,
        })),
      },
      media,
    };
  };
  if (stored !== undefined) return validateChunk(JSON.parse(stored));
  const { chunk, validated } = await fencedSpeech({
    store: options.store,
    version,
    index,
    maySynthesize,
    now: options.now,
    beforeSynthesis: async () => options.beforeSynthesis?.(source.text.length),
    beforeSend: options.beforeSend,
    request: () => speechRequest(source, options),
    async decode(raw) {
      const chunk = await decodeResponse(source, raw);
      return { chunk, validated: await validateChunk(chunk) };
    },
  });
  await options.store.put(key, JSON.stringify(chunk));
  return validated;
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

export function narrationVoiceHash(
  options: Pick<NarrationPublication, 'voiceId' | 'voiceRevision' | 'limit'>,
) {
  return narrationDigest(
    JSON.stringify({
      algorithm: narrationVersion,
      synthesis,
      format,
      limit: options.limit ?? chunkLimit,
      voiceId: options.voiceId,
      voiceRevision: options.voiceRevision,
    }),
  );
}

function recordingVersion(textHash: string, options: NarrationPublication) {
  return narrationDigest(
    JSON.stringify({
      textHash,
      algorithm: narrationVersion,
      synthesis,
      format,
      limit: options.limit ?? chunkLimit,
      voiceId: options.voiceId,
      voiceRevision: options.voiceRevision,
    }),
  );
}

function canonicalOffsets(legacy: string) {
  const positions: number[] = [];
  let position = 0;
  let inWhitespace = false;
  for (let index = 0; index < legacy.length; index++) {
    const whitespace = /\s/u.test(legacy[index]);
    if (whitespace && inWhitespace) {
      positions.push(position - 1);
      continue;
    }
    positions.push(position++);
    inWhitespace = whitespace;
  }
  return positions;
}

function checkManifestCapacity(sources: SourceChunk[]) {
  if (!sources.some((source) => source.words.length > 0)) {
    throw new NarrationAttemptUnavailable(
      'Narration has no highlightable words',
    );
  }
  // Reserve more than the JSON keys, separators, full finite-number encodings
  // and digests can occupy, including the public voice hash.
  const estimate = sources.reduce(
    (size, source) => size + 160 + source.words.length * 128,
    512,
  );
  if (sources.length > 10_000 || estimate > maxAssetBytes) {
    throw new NarrationAttemptUnavailable(
      'Narration manifest would exceed its serving limit',
    );
  }
}

export async function publishNarrationArticle(
  text: string,
  options: NarrationPublication,
  destination: NarrationDestination,
) {
  const canonicalHash = await narrationDigest(text);
  const canonicalVersion = await recordingVersion(canonicalHash, options);
  const selectionKey = `blog-narration-aliases/${canonicalVersion}.json`;
  const selected = await options.store.get(selectionKey);
  const selection =
    selected === undefined
      ? undefined
      : (JSON.parse(selected) as { text?: unknown; version?: unknown } | null);
  let recordingText = text;
  let textHash = canonicalHash;
  let version = canonicalVersion;
  let prefix = `blog-narration/${version}`;
  let previous = await options.store.get(`${prefix}/manifest.json`);
  if (selected !== undefined) {
    if (
      typeof selection?.text !== 'string' ||
      (selection.text !== text && selection.text.replace(/\s+/gu, ' ') !== text)
    )
      throw new Error('Invalid narration version selection');
    recordingText = selection.text;
    textHash = await narrationDigest(recordingText);
    version = await recordingVersion(textHash, options);
    if (selection.version !== version)
      throw new Error('Invalid narration version selection');
    if (version !== canonicalVersion) {
      prefix = `blog-narration/${version}`;
      previous = await options.store.get(`${prefix}/manifest.json`);
    }
  } else {
    const legacy = options.legacyText;
    if (
      previous === undefined &&
      legacy &&
      legacy !== text &&
      legacy.replace(/\s+/gu, ' ') === text &&
      (await options.store.get(`${prefix}/0.json`)) === undefined &&
      (await options.store.readVersioned(
        `blog-narration-attempts/${version}/0.json`,
      )) === undefined
    ) {
      const legacyHash = await narrationDigest(legacy);
      const legacyVersion = await recordingVersion(legacyHash, options);
      const legacyPrefix = `blog-narration/${legacyVersion}`;
      const legacyManifest = await options.store.get(
        `${legacyPrefix}/manifest.json`,
      );
      if (
        legacyManifest !== undefined ||
        (await options.store.get(`${legacyPrefix}/0.json`)) !== undefined
      ) {
        recordingText = legacy;
        textHash = legacyHash;
        version = legacyVersion;
        prefix = legacyPrefix;
        previous = legacyManifest;
      }
    }
  }

  let pinned = selected !== undefined;
  const pinRecording = async () => {
    if (pinned) return;
    if (
      !(await options.store.compareAndSet(
        selectionKey,
        JSON.stringify({ text: recordingText, version }),
        undefined,
      ))
    )
      throw new NarrationAttemptUnavailable(
        'Narration recording selection already changed',
      );
    pinned = true;
  };
  const candidate = {
    ...options,
    async beforeSynthesis(characters: number) {
      await options.beforeSynthesis?.(characters);
      await pinRecording();
    },
  };
  const manifestKey = `${prefix}/manifest.json`;
  const sources = splitNarration(recordingText, options.limit ?? chunkLimit);
  checkManifestCapacity(sources);
  const manifest: NarrationManifest = { version, textHash, chunks: [] };
  for (const [index, source] of sources.entries()) {
    const { timing, media } = await cachedChunk(
      source,
      recordingText,
      version,
      index,
      previous === undefined,
      candidate,
    );
    manifest.chunks.push(timing);
    await destination.writeAudio(narrationMediaPath(version, index), media);
  }
  const manifestJson = JSON.stringify(manifest);
  if (
    !validateManifest(manifest, recordingText) ||
    Buffer.byteLength(manifestJson) > maxAssetBytes
  ) {
    throw new Error('Invalid narration manifest');
  }
  if (previous !== undefined && previous !== manifestJson) {
    throw new Error('Committed narration does not match its cached chunks');
  }
  if (previous === undefined)
    await options.store.put(manifestKey, manifestJson);
  await pinRecording();
  if (recordingText === text) {
    await destination.writeManifest(manifestJson);
    return;
  }
  const positions = canonicalOffsets(recordingText);
  const publicManifest = {
    ...manifest,
    textHash: canonicalHash,
    chunks: manifest.chunks.map((chunk) => ({
      ...chunk,
      words: chunk.words.map((word) => ({
        ...word,
        from: positions[word.from],
        to: positions[word.to - 1] + 1,
      })),
    })),
  };
  if (!validateManifest(publicManifest, text)) {
    throw new Error('Legacy narration offsets do not match canonical text');
  }
  await destination.writeManifest(JSON.stringify(publicManifest));
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
      await publishNarrationArticle(
        text,
        {
          ...options,
          legacyText: extractNarration(document, undefined, true).text,
        },
        {
          writeAudio: (path, media) => writeAsset(join(output, path), media),
          writeManifest: (manifest) =>
            writeAsset(join(dirname(page), 'narration.json'), manifest),
        },
      );
    } catch (error) {
      failures.push(
        `${dirname(article)}: ${error instanceof Error ? error.message : 'Narration failed'}`,
      );
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));
}
