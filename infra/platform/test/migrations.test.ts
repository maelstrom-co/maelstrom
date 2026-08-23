import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationsDir = resolve(import.meta.dirname, '../migrations');

// D1 skips a migration file whose name is already recorded as applied, so
// editing an applied file silently desynchronizes the source from the live
// schema while Alchemy keeps reporting success. These hashes pin every
// migration that has reached production. A schema change must always be a new
// ordered file; when a new migration ships, extend this map in the same change.
const APPLIED_MIGRATION_HASHES: Record<string, string> = {
  '0001_create_waitlist.sql':
    'fc27828a60429da6a99f97a97bf5b9f224742c312f45c1f480810a74f35d0abb',
  '0002_index_confirmation_token.sql':
    '3145ce7775fa11e80e6b1d470c4e58d55c768ccef6b9694aa1e12ff25bf47411',
  '0003_add_confirmation_sent_at.sql':
    '32bfae9320e15cf752513f28b9b507b5e2ba909dacbe7c8476bedb1dbc4e8399',
  '0004_create_waitlist_confirmation_deliveries.sql':
    '27da4a2eecc53aa9d55f6582012284599f56fd9c67928d4a09b521159a791585',
  '0005_add_access_receipt.sql':
    'a116b595ad6959774e248a71b6143a4a438a4fd73e82b6d9eddbffb25569324e',
};

describe('applied D1 migrations', () => {
  test('remain byte-identical to the released artifacts', () => {
    for (const [name, hash] of Object.entries(APPLIED_MIGRATION_HASHES)) {
      const content = readFileSync(resolve(migrationsDir, name), 'utf8');
      expect(
        createHash('sha256').update(content).digest('hex'),
        `${name} changed after release; add a new migration instead`,
      ).toBe(hash);
    }
  });

  test('cover every migration file so nothing escapes the append-only rule', () => {
    const files = readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(Object.keys(APPLIED_MIGRATION_HASHES).sort()).toEqual(files);
  });

  test('use one increasing ordinal per file', () => {
    const ordinals = Object.keys(APPLIED_MIGRATION_HASHES).map((name) =>
      Number.parseInt(name.slice(0, 4), 10),
    );
    expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b));
    expect(new Set(ordinals).size).toBe(ordinals.length);
  });
});
