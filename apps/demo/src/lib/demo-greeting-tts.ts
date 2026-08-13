import type { SynthesizeGreeting } from '@maelstrom-co/realtime-openai';
import type { OpenAIBuiltInVoice } from '@maelstrom-co/realtime-protocol/openai';
import { withFetchTimeout } from './fetch-timeout';

/** One-time spoken greeting text — exact string for TTS and captions. */
export const DEMO_GREETING =
  "Hi, I'm the Maelstrom demo assistant, how can I help you today?";

/** Shared Realtime + TTS recommended built-in voice for the demo. */
export const DEMO_OPENAI_VOICE = 'cedar' as const satisfies OpenAIBuiltInVoice;

export const DEMO_GREETING_TTS_URL = 'https://api.openai.com/v1/audio/speech';
export const DEMO_GREETING_TTS_MODEL = 'gpt-4o-mini-tts';
export const DEMO_GREETING_TTS_FORMAT = 'wav';
export const DEMO_GREETING_TTS_INSTRUCTIONS =
  'Sound like a helpful product guide greeting one person. Use a warm, natural conversational tone, relaxed pacing, and subtle enthusiasm. Do not sound like an announcer.';
export const DEMO_GREETING_TTS_MAX_BYTES = 1_048_576;
export const DEMO_GREETING_TTS_ROUTE = '/api/demo-greeting-tts';

/** Exact fixed OpenAI speech request body — five fields only. */
export const DEMO_GREETING_TTS_PAYLOAD = {
  model: DEMO_GREETING_TTS_MODEL,
  input: DEMO_GREETING,
  voice: DEMO_OPENAI_VOICE,
  response_format: DEMO_GREETING_TTS_FORMAT,
  instructions: DEMO_GREETING_TTS_INSTRUCTIONS,
} as const;

const ACCEPTED_WAV_TYPES = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave',
]);

/** Minimum complete canonical WAV header (RIFF/fmt/data scaffolding). */
const MIN_WAV_BYTES = 44;

const GENERIC_TTS_ERROR = 'Greeting audio is temporarily unavailable.';
const INVALID_KEY_ERROR = 'Invalid API key.';

function assertExactGreetingArgs(args: {
  readonly text: string;
  readonly voice: OpenAIBuiltInVoice;
}): void {
  if (args.text !== DEMO_GREETING || args.voice !== DEMO_OPENAI_VOICE) {
    throw new Error(GENERIC_TTS_ERROR);
  }
}

function mediaTypeBase(contentType: string | null): string {
  if (!contentType) return '';
  return contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function isAcceptedWavType(contentType: string | null): boolean {
  return ACCEPTED_WAV_TYPES.has(mediaTypeBase(contentType));
}

function fourCcEquals(
  bytes: Uint8Array,
  offset: number,
  a: number,
  b: number,
  c: number,
  d: number,
): boolean {
  return (
    bytes[offset] === a &&
    bytes[offset + 1] === b &&
    bytes[offset + 2] === c &&
    bytes[offset + 3] === d
  );
}

function hasRiffWaveMagic(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  // RIFF....WAVE
  return (
    fourCcEquals(bytes, 0, 0x52, 0x49, 0x46, 0x46) &&
    fourCcEquals(bytes, 8, 0x57, 0x41, 0x56, 0x45)
  );
}

/**
 * Structural WAV check: RIFF/WAVE magic, declared RIFF size (or OpenAI's
 * 0xFFFFFFFF streamed marker), and bounded top-level chunks that include
 * complete `fmt ` and `data` payloads. Rejects truncated headers, sizes that
 * run past the buffer, and missing odd-chunk pad bytes.
 *
 * Streamed containers may mark both RIFF size and the final `data` chunk size
 * as 0xFFFFFFFF; the already-read buffer then bounds the real payload. An
 * unknown marker is rejected on non-data chunks and on `data` when RIFF size
 * is finite. Arithmetic uses remaining-byte comparisons so sizes cannot wrap
 * into a false-valid result (actual bodies remain capped at 1 MiB upstream).
 */
function hasValidWavContainer(bytes: Uint8Array): boolean {
  if (bytes.byteLength < MIN_WAV_BYTES) return false;
  if (!hasRiffWaveMagic(bytes)) return false;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffSize = view.getUint32(4, true);
  const riffUnknown = riffSize === 0xffff_ffff;
  if (!riffUnknown) {
    if (riffSize < 4) return false;
    // Subtraction form: avoid `riffSize + 8` wrapping a huge size into range.
    if (bytes.byteLength < 8 || riffSize !== bytes.byteLength - 8) return false;
  }

  let offset = 12;
  let hasFmt = false;
  let hasData = false;

  while (offset < bytes.byteLength) {
    // Truncated chunk header at clean EOF.
    if (bytes.byteLength - offset < 8) return false;

    const idIsFmt = fourCcEquals(bytes, offset, 0x66, 0x6d, 0x74, 0x20);
    const idIsData = fourCcEquals(bytes, offset, 0x64, 0x61, 0x74, 0x61);
    const size = view.getUint32(offset + 4, true);
    const sizeUnknown = size === 0xffff_ffff;
    const payloadStart = offset + 8;

    if (sizeUnknown) {
      // Only the final data chunk may use the streamed unknown-length marker,
      // and only when the RIFF size is also unknown.
      if (!idIsData || !riffUnknown || hasData) return false;
      if (payloadStart > bytes.byteLength) return false;
      hasData = true;
      // Data is final: remainder of the already-read buffer is the payload.
      offset = bytes.byteLength;
      continue;
    }

    // Finite sizes: compare against remaining bytes (no addition into validity).
    if (payloadStart > bytes.byteLength) return false;
    const remaining = bytes.byteLength - payloadStart;
    if (size > remaining) return false;
    const payloadEnd = payloadStart + size; // safe: size <= remaining

    if (idIsFmt) {
      // PCM fmt is 16 bytes; extended formats are larger but still need >= 16.
      if (size < 16) return false;
      hasFmt = true;
    } else if (idIsData) {
      hasData = true;
    }

    // Chunks are word-aligned; an odd size requires a present pad byte.
    let next = payloadEnd;
    if (size % 2 === 1) {
      if (next >= bytes.byteLength) return false;
      next += 1;
    }
    // Require forward progress so corrupt sizes cannot loop forever.
    if (next <= offset) return false;
    offset = next;
  }

  return hasFmt && hasData;
}

/** Cancel any unread body and swallow cancellation failures. */
async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Best-effort drain only — never surface cancel or upstream detail.
  }
}

/** Cancel any unread body, then throw a generic error. */
async function rejectResponse(response: Response): Promise<never> {
  await cancelResponseBody(response);
  throw new Error(GENERIC_TTS_ERROR);
}

/**
 * Bounded WAV response reader used for OpenAI→route, route→browser, and
 * OpenAI→hosted-browser. Never surfaces upstream bodies, headers, or keys.
 */
export async function readBoundedWavResponse(
  response: Response,
): Promise<ArrayBuffer> {
  if (!response.ok) {
    return rejectResponse(response);
  }
  if (!isAcceptedWavType(response.headers.get('Content-Type'))) {
    return rejectResponse(response);
  }

  const lengthHeader = response.headers.get('Content-Length');
  let declaredLength: number | undefined;
  if (lengthHeader !== null) {
    const declared = Number(lengthHeader);
    if (
      !Number.isFinite(declared) ||
      !Number.isInteger(declared) ||
      declared < MIN_WAV_BYTES ||
      declared > DEMO_GREETING_TTS_MAX_BYTES
    ) {
      return rejectResponse(response);
    }
    declaredLength = declared;
  }

  const body = response.body;
  if (!body) {
    throw new Error(GENERIC_TTS_ERROR);
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > DEMO_GREETING_TTS_MAX_BYTES) {
        await reader.cancel();
        throw new Error(GENERIC_TTS_ERROR);
      }
      // Fail early when Content-Length is known and the stream overshoots.
      if (declaredLength !== undefined && total > declaredLength) {
        await reader.cancel();
        throw new Error(GENERIC_TTS_ERROR);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof Error && error.message === GENERIC_TTS_ERROR) {
      throw error;
    }
    throw new Error(GENERIC_TTS_ERROR);
  }

  if (total < MIN_WAV_BYTES) {
    throw new Error(GENERIC_TTS_ERROR);
  }

  if (declaredLength !== undefined && total !== declaredLength) {
    throw new Error(GENERIC_TTS_ERROR);
  }

  const exact = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    exact.set(chunk, offset);
    offset += chunk.byteLength;
  }

  if (!hasValidWavContainer(exact)) {
    throw new Error(GENERIC_TTS_ERROR);
  }

  // Return an exact-sized buffer, not a view over larger capacity.
  return exact.buffer.slice(
    exact.byteOffset,
    exact.byteOffset + exact.byteLength,
  );
}

/** Local mode: bodyless same-origin POST to the demo TTS route. */
export function createLocalDemoGreetingSynthesizer(): SynthesizeGreeting {
  return async (args) => {
    assertExactGreetingArgs(args);
    let response: Response;
    try {
      response = await fetch(DEMO_GREETING_TTS_ROUTE, {
        method: 'POST',
        signal: withFetchTimeout(args.signal),
        redirect: 'error',
      });
    } catch {
      throw new Error(GENERIC_TTS_ERROR);
    }
    return readBoundedWavResponse(response);
  };
}

/**
 * Hosted BYOK: browser-direct OpenAI speech with the visitor key.
 * Lazily reads the key on every attempt. Fails closed on redirects.
 */
export function createHostedDemoGreetingSynthesizer(
  getApiKey: () => string | null,
): SynthesizeGreeting {
  return async (args) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('No API key set — open the key drawer to add one.');
    }
    assertExactGreetingArgs(args);

    let response: Response;
    try {
      response = await fetch(DEMO_GREETING_TTS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(DEMO_GREETING_TTS_PAYLOAD),
        signal: withFetchTimeout(args.signal),
        redirect: 'error',
      });
    } catch {
      throw new Error(GENERIC_TTS_ERROR);
    }

    if (response.status === 401) {
      await cancelResponseBody(response);
      throw new Error(INVALID_KEY_ERROR);
    }
    return readBoundedWavResponse(response);
  };
}
