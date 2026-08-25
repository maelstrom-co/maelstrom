import { Database } from 'bun:sqlite';
import { describe, expect, mock, spyOn, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
    private readonly beforeExecute?: (sql: string) => Promise<void>,
  ) {}

  bind(...parameters: ReadonlyArray<unknown>) {
    return new BunSqliteD1Statement(
      this.database,
      this.sql,
      parameters,
      this.beforeExecute,
    );
  }

  async all() {
    await this.beforeExecute?.(this.sql);
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
    await this.beforeExecute?.(this.sql);
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
  beforeExecute?: (sql: string) => Promise<void>,
): D1Database =>
  ({
    prepare: (sql: string) => {
      onPrepare?.(sql);
      return new BunSqliteD1Statement(database, sql, [], beforeExecute);
    },
  }) as unknown as D1Database;

const makeDatabase = () => {
  const database = new Database(':memory:');
  applyMigration(database);
  return database;
};

const makeBarrier = (parties: number) => {
  let arrived = 0;
  let release!: () => void;
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async () => {
    arrived += 1;
    if (arrived === parties) release();
    await open;
  };
};

const expectNoCauseOrRenderedSecret = (error: unknown, secret: string) => {
  const errorObject = Object(error);
  expect(Object.hasOwn(errorObject, 'cause')).toBe(false);
  expect(Reflect.has(errorObject, 'cause')).toBe(false);
  expect(String(error)).not.toContain(secret);
  if (error instanceof Error) expect(error.stack ?? '').not.toContain(secret);
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

const claimDeliveryInput = (id: string, email = 'user@example.com') => ({
  id,
  email,
  tokenHash: `${id}-token`,
  expiresAt: '2026-08-25T13:00:00.000Z',
  attemptedAt: '2026-08-25T12:00:00.000Z',
  cooldownSince: '2026-08-25T11:50:00.000Z',
});

const claimResendInput = (id: string, email = 'user@example.com') => ({
  id,
  email,
  attemptedAt: '2026-08-25T12:00:00.000Z',
  cooldownSince: '2026-08-25T11:50:00.000Z',
});

const claim = (
  repository: WaitlistRepositoryService,
  ledger: Ledger,
  id: string,
  email = 'user@example.com',
) =>
  ledger === 'confirmation'
    ? repository.claimDeliveryAttempt(claimDeliveryInput(id, email))
    : repository.claimResendAttempt(claimResendInput(id, email));

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
  test('creates an initial pending subscriber and confirmation delivery', async () => {
    const database = makeDatabase();
    const statements: string[] = [];

    expect(
      await run(
        d1(database, (sql) => statements.push(sql)),
        (repository) =>
          repository.claimDeliveryAttempt(claimDeliveryInput('initial')),
      ),
    ).toBe(true);
    expect(statements).toHaveLength(2);
    expect(
      database
        .query(
          'SELECT email, status, updated_at FROM waitlist_subscribers WHERE email = ?',
        )
        .get('user@example.com'),
    ).toEqual({
      email: 'user@example.com',
      status: 'pending',
      updated_at: '2026-08-25T12:00:00.000Z',
    });
    expect(
      database
        .query(
          `SELECT id, email, token_hash, expires_at, state, attempted_at,
                  state_changed_at
             FROM waitlist_confirmation_deliveries WHERE id = ?`,
        )
        .get('initial'),
    ).toEqual({
      id: 'initial',
      email: 'user@example.com',
      token_hash: 'initial-token',
      expires_at: '2026-08-25T13:00:00.000Z',
      state: 'attempting',
      attempted_at: '2026-08-25T12:00:00.000Z',
      state_changed_at: '2026-08-25T12:00:00.000Z',
    });
  });

  test.each([
    'confirmed',
    'unsubscribed',
  ] as const)('keeps a %s subscriber terminal during signup', async (status) => {
    const database = makeDatabase();
    database
      .query('INSERT INTO waitlist_subscribers (email, status) VALUES (?, ?)')
      .run('user@example.com', status);

    expect(
      await run(d1(database), (repository) =>
        repository.claimDeliveryAttempt(claimDeliveryInput(status)),
      ),
    ).toBe(false);
    expect(
      database
        .query('SELECT status FROM waitlist_subscribers WHERE email = ?')
        .get('user@example.com'),
    ).toEqual({ status });
    expect(
      database
        .query('SELECT count(*) AS count FROM waitlist_confirmation_deliveries')
        .get(),
    ).toEqual({ count: 0 });
  });

  test.each([
    [
      'signup excludes rejected and retryable outcomes from cooldown',
      'attempting',
      'confirmation',
      false,
    ],
    [
      'signup excludes rejected and retryable outcomes from cooldown',
      'accepted',
      'confirmation',
      false,
    ],
    [
      'signup excludes rejected and retryable outcomes from cooldown',
      'unknown',
      'confirmation',
      false,
    ],
    [
      'signup excludes rejected and retryable outcomes from cooldown',
      'rejected',
      'confirmation',
      true,
    ],
    [
      'signup excludes rejected and retryable outcomes from cooldown',
      'retryable',
      'confirmation',
      true,
    ],
    ['resend cooldown includes every outcome', 'attempting', 'resend', false],
    ['resend cooldown includes every outcome', 'accepted', 'resend', false],
    ['resend cooldown includes every outcome', 'unknown', 'resend', false],
    ['resend cooldown includes every outcome', 'rejected', 'resend', false],
    ['resend cooldown includes every outcome', 'retryable', 'resend', false],
  ] as const)('%s after a recent %s attempt', async (_policy, state, ledger, expected) => {
    const database = makeDatabase();
    database
      .query('INSERT INTO waitlist_subscribers (email, status) VALUES (?, ?)')
      .run(
        'user@example.com',
        ledger === 'confirmation' ? 'pending' : 'confirmed',
      );
    if (ledger === 'confirmation') {
      database
        .query(
          `INSERT INTO waitlist_confirmation_deliveries (
              id, email, token_hash, expires_at, state, attempted_at,
              state_changed_at
            ) VALUES ('existing', ?, 'existing-token', ?, ?, ?, ?)`,
        )
        .run(
          'user@example.com',
          '2026-08-25T13:00:00.000Z',
          state,
          '2026-08-25T11:59:00.000Z',
          '2026-08-25T11:59:00.000Z',
        );
    } else {
      database
        .query(
          `INSERT INTO waitlist_resend_deliveries (
              id, email, state, attempted_at, state_changed_at
            ) VALUES ('existing', ?, ?, ?, ?)`,
        )
        .run(
          'user@example.com',
          state,
          '2026-08-25T11:59:00.000Z',
          '2026-08-25T11:59:00.000Z',
        );
    }

    expect(
      await run(d1(database), (repository) =>
        claim(repository, ledger, 'next'),
      ),
    ).toBe(expected);
  });

  test.each([
    ['confirmation', 'exactly at', '2026-08-25T11:50:00.000Z'],
    ['confirmation', 'before', '2026-08-25T11:49:59.999Z'],
    ['resend', 'exactly at', '2026-08-25T11:50:00.000Z'],
    ['resend', 'before', '2026-08-25T11:49:59.999Z'],
  ] as const)('allows a %s claim after an attempt %s cooldownSince', async (ledger, _edge, attemptedAt) => {
    const database = makeDatabase();
    database
      .query('INSERT INTO waitlist_subscribers (email, status) VALUES (?, ?)')
      .run(
        'user@example.com',
        ledger === 'confirmation' ? 'pending' : 'confirmed',
      );
    if (ledger === 'confirmation') {
      database
        .query(
          `INSERT INTO waitlist_confirmation_deliveries (
            id, email, token_hash, expires_at, state, attempted_at,
            state_changed_at
          ) VALUES ('existing', ?, 'existing-token', ?, 'accepted', ?, ?)`,
        )
        .run(
          'user@example.com',
          '2026-08-25T13:00:00.000Z',
          attemptedAt,
          attemptedAt,
        );
    } else {
      database
        .query(
          `INSERT INTO waitlist_resend_deliveries (
            id, email, state, attempted_at, state_changed_at
          ) VALUES ('existing', ?, 'accepted', ?, ?)`,
        )
        .run('user@example.com', attemptedAt, attemptedAt);
    }

    expect(
      await run(d1(database), (repository) =>
        claim(repository, ledger, 'next'),
      ),
    ).toBe(true);
  });

  test.each([
    'rejected',
    'retryable',
  ] as const)('a recent %s resend starts durable cooldown, unlike the same signup outcome', async (state) => {
    const signupDatabase = makeDatabase();
    signupDatabase
      .query(
        "INSERT INTO waitlist_subscribers (email, status) VALUES (?, 'pending')",
      )
      .run('user@example.com');
    signupDatabase
      .query(
        `INSERT INTO waitlist_confirmation_deliveries (
          id, email, token_hash, expires_at, state, attempted_at,
          state_changed_at
        ) VALUES ('existing', ?, 'existing-token', ?, ?, ?, ?)`,
      )
      .run(
        'user@example.com',
        '2026-08-25T13:00:00.000Z',
        state,
        '2026-08-25T11:59:00.000Z',
        '2026-08-25T11:59:00.000Z',
      );
    const resendDatabase = makeDatabase();
    resendDatabase
      .query(
        "INSERT INTO waitlist_subscribers (email, status) VALUES (?, 'confirmed')",
      )
      .run('user@example.com');
    resendDatabase
      .query(
        `INSERT INTO waitlist_resend_deliveries (
          id, email, state, attempted_at, state_changed_at
        ) VALUES ('existing', ?, ?, ?, ?)`,
      )
      .run(
        'user@example.com',
        state,
        '2026-08-25T11:59:00.000Z',
        '2026-08-25T11:59:00.000Z',
      );

    expect(
      await run(d1(signupDatabase), (repository) =>
        repository.claimDeliveryAttempt(claimDeliveryInput('signup-next')),
      ),
    ).toBe(true);
    expect(
      await run(d1(resendDatabase), (repository) =>
        repository.claimResendAttempt(claimResendInput('resend-next')),
      ),
    ).toBe(false);
  });

  test.each([
    ['confirmation', 'after', '2026-08-25T12:00:00.001Z', false],
    ['confirmation', 'equal to', '2026-08-25T12:00:00.000Z', true],
    ['confirmation', 'before', '2026-08-25T11:59:59.999Z', true],
    ['resend', 'after', '2026-08-25T12:00:00.001Z', false],
    ['resend', 'equal to', '2026-08-25T12:00:00.000Z', true],
    ['resend', 'before', '2026-08-25T11:59:59.999Z', true],
  ] as const)('a %s claim treats retryAfter %s attemptedAt (%s)', async (ledger, _edge, retryAfter, expected) => {
    const database = makeDatabase();
    if (ledger === 'resend') {
      database
        .query(
          "INSERT INTO waitlist_subscribers (email, status) VALUES (?, 'confirmed')",
        )
        .run('user@example.com');
    }
    database
      .query(
        `INSERT INTO waitlist_delivery_backoffs (
          provider, retry_after, failure_code, updated_at
        ) VALUES ('email', ?, 'E_RATE_LIMIT_EXCEEDED', ?)`,
      )
      .run(retryAfter, '2026-08-25T11:59:00.000Z');

    expect(
      await run(d1(database), (repository) =>
        claim(repository, ledger, 'blocked'),
      ),
    ).toBe(expected);
  });

  test('resend returns the same false result for unknown and non-confirmed addresses', async () => {
    const database = makeDatabase();
    database
      .query(
        `INSERT INTO waitlist_subscribers (email, status) VALUES
          ('pending@example.com', 'pending'),
          ('unsubscribed@example.com', 'unsubscribed'),
          ('confirmed@example.com', 'confirmed')`,
      )
      .run();
    const binding = d1(database);

    for (const email of [
      'unknown@example.com',
      'pending@example.com',
      'unsubscribed@example.com',
    ]) {
      expect(
        await run(binding, (repository) =>
          repository.claimResendAttempt(claimResendInput(email, email)),
        ),
      ).toBe(false);
    }
    expect(
      await run(binding, (repository) =>
        repository.claimResendAttempt(
          claimResendInput('confirmed', 'confirmed@example.com'),
        ),
      ),
    ).toBe(true);
  });

  test.each([
    ['confirmation', 'waitlist_confirmation_deliveries', 2],
    ['resend', 'waitlist_resend_deliveries', 1],
  ] as const)('atomically excludes duplicate %s claims across two SQLite connections', async (ledger, claimTable, expectedStatementsPerConnection) => {
    const directory = mkdtempSync(join(tmpdir(), 'maelstrom-waitlist-claims-'));
    const databasePath = join(directory, 'waitlist.sqlite');
    const first = new Database(databasePath, { create: true });
    let second: Database | undefined;

    try {
      applyMigration(first);
      second = new Database(databasePath);
      second.exec('PRAGMA foreign_keys = ON');
      if (ledger === 'resend') {
        first
          .query(
            "INSERT INTO waitlist_subscribers (email, status) VALUES (?, 'confirmed')",
          )
          .run('user@example.com');
      }

      const barrier = makeBarrier(2);
      const statements: [string[], string[]] = [[], []];
      const reachedClaimExecution: string[] = [];
      const beforeExecute = async (sql: string) => {
        if (!sql.toLowerCase().includes(claimTable)) return;
        reachedClaimExecution.push(sql);
        await barrier();
      };

      const claims = await Promise.all([
        run(
          d1(first, (sql) => statements[0].push(sql), beforeExecute),
          (repository) => claim(repository, ledger, 'concurrent-1'),
        ),
        run(
          d1(second, (sql) => statements[1].push(sql), beforeExecute),
          (repository) => claim(repository, ledger, 'concurrent-2'),
        ),
      ]);

      expect(reachedClaimExecution).toHaveLength(2);
      expect(claims.filter(Boolean)).toHaveLength(1);
      for (const prepared of statements) {
        expect(prepared).toHaveLength(expectedStatementsPerConnection);
        expect(
          prepared.every((sql) =>
            sql.trimStart().toLowerCase().startsWith('insert into'),
          ),
        ).toBe(true);
      }
    } finally {
      second?.close();
      first.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test.each([
    ['confirmation', 'claimDeliveryAttempt'],
    ['resend', 'claimResendAttempt'],
  ] as const)('maps a failed %s claim to a sanitized operation error', async (ledger, operation) => {
    const secret = 'private-provider-payload';
    const failingBinding = {
      prepare: () => ({
        bind: () => ({
          all: async () => {
            throw new Error(secret);
          },
          raw: async () => {
            throw new Error(secret);
          },
        }),
      }),
    } as unknown as D1Database;

    const error = await run(failingBinding, (repository) =>
      Effect.flip(claim(repository, ledger, 'failed')),
    );

    expect(error).toMatchObject({
      _tag: 'WaitlistPersistenceError',
      operation,
    });
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain('user@example.com');
    expectNoCauseOrRenderedSecret(error, secret);
  });

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
    expectNoCauseOrRenderedSecret(error, secret);
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
    expectNoCauseOrRenderedSecret(error, secret);
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
