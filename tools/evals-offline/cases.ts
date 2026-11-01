import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Fixture,
  type LoadedCase,
  parseOfflineCase,
  validateLoadedCase,
} from '../../packages/evals/src/adapters/offline-case.js';
import {
  evalCaseIndexSchema,
  evalFixtureSchema,
} from '../../packages/evals/src/core/case-schema.js';

/** Explicit file index only; no recursive discovery or imports selected by case contents. */
export function loadOfflineCases(
  root = fileURLToPath(
    new URL('../../packages/evals/cases/v1/', import.meta.url),
  ),
): readonly LoadedCase[] {
  const directory = resolve(root);
  if (!lstatSync(directory).isDirectory())
    throw new Error('Expected regular case directory');
  const index = evalCaseIndexSchema.parse(
    readJson(directory, 'index.json').value,
  );
  if (!lstatSync(join(directory, 'fixtures')).isDirectory())
    throw new Error('Expected regular fixture directory');
  const fixtures = new Map<string, { fixture: Fixture; digest: string }>();
  for (const file of index.fixtures) {
    const { value, digest } = readJson(join(directory, 'fixtures'), file);
    const fixture = evalFixtureSchema.parse(value);
    if (fixtures.has(fixture.id))
      throw new Error(`Duplicate fixture: ${fixture.id}`);
    fixtures.set(fixture.id, { fixture, digest });
  }
  const seen = new Set<string>();
  const cases = index.cases.map((file) => {
    const { value, digest } = readJson(directory, file);
    const definition = parseOfflineCase(value);
    if (seen.has(definition.id))
      throw new Error(`Duplicate case: ${definition.id}`);
    seen.add(definition.id);
    const fixture = fixtures.get(definition.fixtureId);
    if (!fixture) throw new Error(`Missing fixture: ${definition.fixtureId}`);
    return freeze(
      validateLoadedCase({
        definition,
        fixture: fixture.fixture,
        caseDigest: digest,
        fixtureDigest: fixture.digest,
      }),
    );
  });
  const referenced = new Set(
    cases.map(({ definition }) => definition.fixtureId),
  );
  for (const id of fixtures.keys())
    if (!referenced.has(id)) throw new Error(`Unreferenced fixture: ${id}`);
  return cases;
}

function readJson(
  directory: string,
  filename: string,
): { value: unknown; digest: string } {
  // Filenames are validated before this function; reject symlinks and bound file reads too.
  const path = join(directory, filename);
  // Nonblocking open lets fstat reject a FIFO without waiting for a writer.
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 65_536)
      throw new Error('Expected bounded regular JSON file');
    const buffer = Buffer.alloc(65_537);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size > 65_536) throw new Error('JSON file exceeds limit');
    const bytes = buffer.subarray(0, size);
    return {
      value: JSON.parse(bytes.toString('utf8')),
      digest: createHash('sha256').update(bytes).digest('hex'),
    };
  } finally {
    closeSync(fd);
  }
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
