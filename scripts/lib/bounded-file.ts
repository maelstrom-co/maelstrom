import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from 'node:fs';

/** Reads one validated file object within its size bound, including on a mutable path. */
export function readBoundedFile(path: string, limit: number): Buffer {
  const invalid = () => new Error('Input requires a bounded regular file');
  if (!Number.isSafeInteger(limit) || limit <= 0) throw invalid();
  const initial = lstatSync(path, { bigint: true });
  if (
    !initial.isFile() ||
    initial.isSymbolicLink() ||
    initial.size === 0n ||
    initial.size > BigInt(limit)
  )
    throw invalid();
  let descriptor: number;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
  } catch (error) {
    if (
      ['ELOOP', 'EMLINK'].includes((error as NodeJS.ErrnoException).code ?? '')
    )
      throw invalid();
    throw error;
  }
  try {
    const stat = fstatSync(descriptor, { bigint: true });
    if (
      !stat.isFile() ||
      stat.size === 0n ||
      stat.size > BigInt(limit) ||
      stat.dev !== initial.dev ||
      stat.ino !== initial.ino ||
      stat.size !== initial.size
    )
      throw invalid();
    const size = Number(stat.size);
    const bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const count = readSync(descriptor, bytes, offset, size - offset, offset);
      if (count === 0) throw invalid();
      offset += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    if (
      after.size !== stat.size ||
      after.mtimeNs !== stat.mtimeNs ||
      after.ctimeNs !== stat.ctimeNs
    )
      throw invalid();
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}
