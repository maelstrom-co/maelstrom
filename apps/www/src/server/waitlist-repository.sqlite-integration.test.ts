import { Database } from 'bun:sqlite';
import { describe, expect, mock, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Effect } from 'effect';
import { createWaitlistToken, hashWaitlistToken } from '../lib/waitlist-token';
import {
  hasProductionWaitlistReceipt,
  hasValidWaitlistReceipt,
} from './waitlist-access';
import {
  WaitlistRepository,
  type WaitlistRepositoryService,
} from './waitlist-repository';

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    '../../../../infra/platform/drizzle/migrations/20260823231809_init_waitlist/migration.sql',
  ),
  'utf8',
);

const applyMigration = (database: Database) => {
  database.exec('PRAGMA foreign_keys = ON');
  for (const statement of migration.split('--> statement-breakpoint')) {
    if (statement.trim()) database.exec(statement);
  }
};

class BunSqliteD1Statement {
  constructor(
    private readonly database: Database,
    private readonly sql: string,
    private readonly parameters: ReadonlyArray<unknown> = [],
  ) {}

  bind(...parameters: ReadonlyArray<unknown>) {
    return new BunSqliteD1Statement(this.database, this.sql, parameters);
  }

  async all() {
    const statement = this.database.prepare(this.sql);
    try {
      return {
        results: statement.all(...this.parameters),
        success: true,
        meta: {},
      };
    } finally {
      statement.finalize();
    }
  }

  async raw() {
    const statement = this.database.prepare(this.sql);
    try {
      return statement.values(...this.parameters);
    } finally {
      statement.finalize();
    }
  }
}

const d1 = (
  database: Database,
  onPrepare?: (sql: string) => void,
): D1Database =>
  ({
    prepare: (sql: string) => {
      onPrepare?.(sql);
      return new BunSqliteD1Statement(database, sql);
    },
  }) as unknown as D1Database;

const makeDatabase = () => {
  const database = new Database(':memory:');
  applyMigration(database);
  return database;
};

const run = <A>(
  database: D1Database,
  use: (repository: WaitlistRepositoryService) => Effect.Effect<A, unknown>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* use(yield* WaitlistRepository);
    }).pipe(Effect.provide(WaitlistRepository.layer(database))),
  );

type Ledger = 'confirmation' | 'resend';
type Outcome = 'accepted' | 'rejected' | 'unknown';

const seedAttempt = (database: Database, ledger: Ledger, id: string) => {
  const email = `${ledger}@example.com`;
  database
    .query('INSERT INTO waitlist_subscribers (email, status) VALUES (?, ?)')
    .run(email, ledger === 'confirmation' ? 'pending' : 'confirmed');
  if (ledger === 'confirmation') {
    database
      .query(
        `INSERT INTO waitlist_confirmation_deliveries (
          id, email, token_hash, expires_at, state, attempted_at,
          state_changed_at
        ) VALUES (?, ?, ?, ?, 'attempting', ?, ?)`,
      )
      .run(
        id,
        email,
        `${id}-token`,
        '2026-08-25T02:00:00.000Z',
        '2026-08-25T00:00:00.000Z',
        '2026-08-25T00:00:00.000Z',
      );
    return;
  }
  database
    .query(
      `INSERT INTO waitlist_resend_deliveries (
        id, email, state, attempted_at, state_changed_at
      ) VALUES (?, ?, 'attempting', ?, ?)`,
    )
    .run(id, email, '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z');
};

const transition = (
  repository: WaitlistRepositoryService,
  ledger: Ledger,
  outcome: Outcome,
  id: string,
  metadata: string,
  changedAt: string,
) => {
  if (ledger === 'confirmation') {
    if (outcome === 'accepted') {
      return repository.markAccepted(id, metadata, changedAt);
    }
    if (outcome === 'rejected') {
      return repository.markRejected(id, metadata, changedAt);
    }
    return repository.markUnknown(id, metadata, changedAt);
  }
  if (outcome === 'accepted') {
    return repository.markResendAccepted(id, metadata, changedAt);
  }
  if (outcome === 'rejected') {
    return repository.markResendRejected(id, metadata, changedAt);
  }
  return repository.markResendUnknown(id, metadata, changedAt);
};

describe('WaitlistRepository Bun SQLite-backed D1 adapter integration', () => {
  test.each([
    ['confirmation', 'accepted'],
    ['confirmation', 'rejected'],
    ['confirmation', 'unknown'],
    ['resend', 'accepted'],
    ['resend', 'rejected'],
    ['resend', 'unknown'],
  ] as const)('settles only attempting %s deliveries as %s with typed metadata', async (ledger, outcome) => {
    const database = makeDatabase();
    const id = `${ledger}-${outcome}`;
    const metadata = outcome === 'accepted' ? 'provider-message' : 'E_PROVIDER';
    const changedAt = '2026-08-25T00:00:01.000Z';
    seedAttempt(database, ledger, id);

    await run(d1(database), (repository) =>
      transition(repository, ledger, outcome, id, metadata, changedAt),
    );

    const table =
      ledger === 'confirmation'
        ? 'waitlist_confirmation_deliveries'
        : 'waitlist_resend_deliveries';
    expect(
      database
        .query(
          `SELECT state, state_changed_at, provider_message_id, failure_code
             FROM ${table} WHERE id = ?`,
        )
        .get(id),
    ).toEqual({
      state: outcome,
      state_changed_at: changedAt,
      provider_message_id: outcome === 'accepted' ? metadata : null,
      failure_code: outcome === 'accepted' ? null : metadata,
    });
  });

  test.each([
    'confirmation',
    'resend',
  ] as const)('accepts exact %s replay without rewriting settlement time', async (ledger) => {
    const database = makeDatabase();
    const id = `${ledger}-replay`;
    seedAttempt(database, ledger, id);
    const binding = d1(database);

    await run(binding, (repository) =>
      transition(
        repository,
        ledger,
        'accepted',
        id,
        'provider-message',
        '2026-08-25T00:00:01.000Z',
      ),
    );
    await run(binding, (repository) =>
      transition(
        repository,
        ledger,
        'accepted',
        id,
        'provider-message',
        '2026-08-25T00:00:02.000Z',
      ),
    );

    const table =
      ledger === 'confirmation'
        ? 'waitlist_confirmation_deliveries'
        : 'waitlist_resend_deliveries';
    expect(
      database
        .query(`SELECT state_changed_at FROM ${table} WHERE id = ?`)
        .get(id),
    ).toEqual({ state_changed_at: '2026-08-25T00:00:01.000Z' });
  });

  test.each([
    'confirmation',
    'resend',
  ] as const)('rejects conflicting %s replay to protect settled provider evidence', async (ledger) => {
    const database = makeDatabase();
    const id = `${ledger}-conflict`;
    seedAttempt(database, ledger, id);
    const binding = d1(database);
    await run(binding, (repository) =>
      transition(
        repository,
        ledger,
        'accepted',
        id,
        'provider-message',
        '2026-08-25T00:00:01.000Z',
      ),
    );

    const error = await run(binding, (repository) =>
      Effect.flip(
        transition(
          repository,
          ledger,
          'accepted',
          id,
          'different-message',
          '2026-08-25T00:00:02.000Z',
        ),
      ),
    );
    expect(error).toMatchObject({ _tag: 'DeliveryStateConflict' });
  });

  test.each([
    'confirmation',
    'resend',
  ] as const)('reports a missing %s attempt as a domain conflict', async (ledger) => {
    const error = await run(d1(makeDatabase()), (repository) =>
      Effect.flip(
        transition(
          repository,
          ledger,
          'unknown',
          'missing',
          'E_UNKNOWN',
          '2026-08-25T00:00:01.000Z',
        ),
      ),
    );
    expect(error).toMatchObject({ _tag: 'DeliveryStateConflict' });
  });

  test('grants access only to the matching unexpired receipt hash', async () => {
    const database = makeDatabase();
    database
      .query(
        `INSERT INTO waitlist_subscribers (
          email, status, access_receipt_hash, access_receipt_expires_at
        ) VALUES (?, 'confirmed', ?, ?)`,
      )
      .run('confirmed@example.com', 'receipt-hash', '2026-08-25T01:00:00.000Z');
    const binding = d1(database);

    expect(
      await run(binding, (repository) =>
        repository.hasValidAccessReceipt(
          'receipt-hash',
          '2026-08-25T00:59:59.999Z',
        ),
      ),
    ).toBe(true);
    expect(
      await run(binding, (repository) =>
        repository.hasValidAccessReceipt(
          'receipt-hash',
          '2026-08-25T01:00:00.000Z',
        ),
      ),
    ).toBe(false);
    expect(
      await run(binding, (repository) =>
        repository.hasValidAccessReceipt(
          'different-hash',
          '2026-08-25T00:59:59.999Z',
        ),
      ),
    ).toBe(false);
  });

  test('validates the production page receipt through the SQLite-backed D1 adapter', async () => {
    const database = makeDatabase();
    const receipt = createWaitlistToken();
    database
      .query(
        `INSERT INTO waitlist_subscribers (
          email, status, access_receipt_hash, access_receipt_expires_at
        ) VALUES (?, 'confirmed', ?, ?)`,
      )
      .run(
        'confirmed@example.com',
        await hashWaitlistToken(receipt),
        '2026-08-25T01:00:00.000Z',
      );
    const preparedSql: string[] = [];
    const loadDatabase = mock(async () =>
      d1(database, (sql) => preparedSql.push(sql)),
    );

    expect(
      await hasProductionWaitlistReceipt({
        receipt,
        now: '2026-08-25T00:59:59.999Z',
        loadDatabase,
      }),
    ).toBe(true);
    expect(loadDatabase).toHaveBeenCalledTimes(1);
    expect(preparedSql).toHaveLength(1);
    const receiptLookup = preparedSql[0]?.trim().toLowerCase() ?? '';
    expect(receiptLookup.startsWith('select ')).toBe(true);
    expect(receiptLookup).toContain('waitlist_subscribers');
    expect(
      await hasValidWaitlistReceipt(
        d1(database),
        'not-a-receipt',
        '2026-08-25T00:59:59.999Z',
      ),
    ).toBe(false);
  });

  test('maps Drizzle failures without exposing SQL or provider payloads', async () => {
    const secret = 'provider-secret-payload';
    const failingBinding = {
      prepare: () => ({
        bind: () => ({
          all: async () => {
            throw new Error(secret);
          },
        }),
      }),
    } as unknown as D1Database;

    const error = await run(failingBinding, (repository) =>
      Effect.flip(
        repository.hasValidAccessReceipt(
          'receipt-hash',
          '2026-08-25T00:00:00.000Z',
        ),
      ),
    );

    expect(error).toMatchObject({
      _tag: 'WaitlistPersistenceError',
      operation: 'hasValidAccessReceipt',
    });
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain('waitlist_subscribers');
  });

  test('names a failed transition with its public repository operation', async () => {
    const secret = 'private-transition-payload';
    const failingBinding = {
      prepare: () => ({
        bind: () => ({
          raw: async () => {
            throw new Error(secret);
          },
        }),
      }),
    } as unknown as D1Database;

    const error = await run(failingBinding, (repository) =>
      Effect.flip(
        repository.markAccepted(
          'attempt-id',
          'provider-message',
          '2026-08-25T00:00:01.000Z',
        ),
      ),
    );

    expect(error).toMatchObject({
      _tag: 'WaitlistPersistenceError',
      operation: 'markAccepted',
    });
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  test('denies receipt access and logs a redacted persistence category', async () => {
    const secret = 'private-receipt-provider-payload';
    const receipt = createWaitlistToken();
    const errorLog = spyOn(console, 'error').mockImplementation(() => {});
    const failingBinding = {
      prepare: () => ({
        bind: () => ({
          all: async () => {
            throw new Error(secret);
          },
        }),
      }),
    } as unknown as D1Database;

    try {
      expect(
        await hasValidWaitlistReceipt(
          failingBinding,
          receipt,
          '2026-08-25T00:00:00.000Z',
        ),
      ).toBe(false);
      expect(errorLog).toHaveBeenCalledWith({
        message: 'waitlist receipt access denied',
        category: 'receipt_persistence_failed',
      });
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret);
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(receipt);
    } finally {
      errorLog.mockRestore();
    }
  });

  test('denies receipt access and redacts a typed hash failure', async () => {
    const secret = 'private-hash-failure';
    const receipt = createWaitlistToken();
    const errorLog = spyOn(console, 'error').mockImplementation(() => {});
    const digest = spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(
      new Error(secret),
    );

    try {
      expect(
        await hasValidWaitlistReceipt(
          d1(makeDatabase()),
          receipt,
          '2026-08-25T00:00:00.000Z',
        ),
      ).toBe(false);
      expect(errorLog).toHaveBeenCalledWith({
        message: 'waitlist receipt access denied',
        category: 'receipt_hash_failed',
      });
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret);
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(receipt);
    } finally {
      digest.mockRestore();
      errorLog.mockRestore();
    }
  });

  test('denies receipt access when the Worker runtime cannot load D1', async () => {
    const secret = 'private-dynamic-import-detail';
    const receipt = createWaitlistToken();
    const errorLog = spyOn(console, 'error').mockImplementation(() => {});

    try {
      expect(
        await hasProductionWaitlistReceipt({
          receipt,
          now: '2026-08-25T00:00:00.000Z',
          loadDatabase: async () => {
            throw new Error(secret);
          },
        }),
      ).toBe(false);
      expect(errorLog).toHaveBeenCalledWith({
        message: 'waitlist receipt access denied',
        category: 'receipt_runtime_unavailable',
      });
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret);
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(receipt);
    } finally {
      errorLog.mockRestore();
    }
  });
});
