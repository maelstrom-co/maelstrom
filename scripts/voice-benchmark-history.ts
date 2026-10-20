import { createHash } from 'node:crypto';
import {
  createVoiceBenchmarkArchive,
  type PreviewGithubDependencies,
  readVoiceBenchmarkArchive,
  VOICE_BENCHMARK_ARCHIVE_MARKER,
  type VoiceBenchmarkOptions,
} from './preview-lifecycle.ts';

/** Per-comment bound, not a limit on the number of consumed benchmark requests. */
export const VOICE_HISTORY_CHUNK_SIZE = 256;

/** Content-addressed pointer to a bot-owned archive on the same PR. */
export interface VoiceHistoryReference {
  /** GitHub issue comment identity. */
  readonly commentId: number;
  /** SHA-256 of the exact archived comment body. */
  readonly sha256: string;
}

type Archive = {
  readonly version: 1;
  readonly repository: string;
  readonly prNumber: string;
  readonly requestId: number;
  readonly consumed: readonly string[];
  readonly previous: VoiceHistoryReference | null;
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = (body: string) =>
  createHash('sha256').update(body).digest('hex');

/** Rejects malformed pointers rather than treating an unreadable archive as empty history. */
export function parseVoiceHistoryReference(
  value: unknown,
): VoiceHistoryReference | null {
  if (value === null) return null;
  if (
    !object(value) ||
    Object.keys(value).length !== 2 ||
    typeof value.commentId !== 'number' ||
    !Number.isSafeInteger(value.commentId) ||
    value.commentId < 1 ||
    typeof value.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.sha256)
  )
    throw new Error('Invalid benchmark archive reference');
  return { commentId: value.commentId, sha256: value.sha256 };
}

/** Validates a bounded active or archived list without changing any request identity. */
export function parseVoiceConsumed(
  value: unknown,
  requestId: number,
): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > VOICE_HISTORY_CHUNK_SIZE ||
    new Set(value).size !== value.length
  )
    throw new Error('Invalid benchmark consumption ledger');
  for (const identity of value) {
    if (typeof identity !== 'string')
      throw new Error('Invalid benchmark consumption identity');
    const label = /^label:([a-f0-9]{40}):([1-9]\d*)$/.exec(identity);
    if (label) {
      const epoch = Number(label[2]);
      if (!Number.isSafeInteger(epoch) || epoch > requestId)
        throw new Error('Invalid benchmark consumption epoch');
    } else if (!/^manual:[1-9]\d{0,19}:[1-9]\d{0,19}$/.test(identity))
      throw new Error('Invalid benchmark consumption identity');
  }
  return value;
}

const renderArchive = (archive: Archive) =>
  `${VOICE_BENCHMARK_ARCHIVE_MARKER}\n${JSON.stringify(archive)}`;

function parseArchive(
  body: string,
  options: VoiceBenchmarkOptions,
  maximumRequestId: number,
): Archive {
  const prefix = `${VOICE_BENCHMARK_ARCHIVE_MARKER}\n`;
  if (!body.startsWith(prefix))
    throw new Error('Invalid benchmark archive marker');
  const value: unknown = JSON.parse(body.slice(prefix.length));
  if (
    !object(value) ||
    Object.keys(value).length !== 6 ||
    value.version !== 1 ||
    value.repository !== options.repository ||
    value.prNumber !== options.prNumber ||
    typeof value.requestId !== 'number' ||
    !Number.isSafeInteger(value.requestId) ||
    value.requestId < 1 ||
    value.requestId > maximumRequestId
  )
    throw new Error('Invalid benchmark archive schema or ownership');
  return {
    version: 1,
    repository: value.repository,
    prNumber: value.prNumber,
    requestId: value.requestId,
    consumed: parseVoiceConsumed(value.consumed, value.requestId),
    previous: parseVoiceHistoryReference(value.previous),
  };
}

/** Loads every reachable chunk by ID; missing, changed, foreign or cyclic history fails closed. */
export async function readVoiceHistory(
  options: VoiceBenchmarkOptions,
  requestId: number,
  active: readonly string[],
  head: VoiceHistoryReference | null,
  github: () => PreviewGithubDependencies,
): Promise<Set<string>> {
  const consumed = new Set(active);
  const visited = new Set<number>();
  let reference = head;
  let maximumRequestId = requestId;
  while (reference) {
    if (visited.has(reference.commentId))
      throw new Error('Cyclic benchmark archive history');
    visited.add(reference.commentId);
    const comment = await readVoiceBenchmarkArchive(
      options,
      reference.commentId,
      github(),
    );
    if (digest(comment.body) !== reference.sha256)
      throw new Error('Benchmark archive hash mismatch');
    const archive = parseArchive(comment.body, options, maximumRequestId);
    for (const identity of archive.consumed) consumed.add(identity);
    maximumRequestId = archive.requestId;
    reference = archive.previous;
  }
  return consumed;
}

/** Writes and reads back a chunk before its caller persists the new public claim. Orphans are harmless. */
export async function archiveVoiceHistory(
  options: VoiceBenchmarkOptions,
  requestId: number,
  consumed: readonly string[],
  previous: VoiceHistoryReference | null,
  github: () => PreviewGithubDependencies,
): Promise<VoiceHistoryReference> {
  const body = renderArchive({
    version: 1,
    repository: options.repository,
    prNumber: options.prNumber,
    requestId,
    consumed: parseVoiceConsumed(consumed, requestId),
    previous: parseVoiceHistoryReference(previous),
  });
  const created = await createVoiceBenchmarkArchive(options, body, github());
  const persisted = await readVoiceBenchmarkArchive(
    options,
    created.id,
    github(),
  );
  if (persisted.body !== body)
    throw new Error('Benchmark archive was not persisted');
  return { commentId: persisted.id, sha256: digest(body) };
}
