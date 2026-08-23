import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WaitlistDeliveryStore } from './waitlist-delivery-store';

const migrationsDir = resolve(
  import.meta.dir,
  '../../../../infra/platform/migrations',
);

function applyMigration(database: Database, name: string) {
  database.exec(readFileSync(resolve(migrationsDir, name), 'utf8'));
}

class SqliteStatement {
  constructor(
    private readonly database: Database,
    private readonly sql: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new SqliteStatement(this.database, this.sql, values);
  }

  async first<T>() {
    const statement = this.database.prepare(this.sql);
    try {
      return statement.get(...this.values) as T | null;
    } finally {
      statement.finalize();
    }
  }

  execute<T>() {
    const statement = this.database.prepare(this.sql);
    try {
      let results: T[] = [];
      if (/\bRETURNING\b/i.test(this.sql)) {
        results = statement.all(...this.values) as T[];
      } else {
        statement.run(...this.values);
      }
      return { results, success: true };
    } finally {
      statement.finalize();
    }
  }

  async run<T>() {
    return this.execute<T>();
  }
}

function d1(database: Database): D1Database {
  return {
    prepare: (sql: string) => new SqliteStatement(database, sql),
    batch: async <T>(statements: D1PreparedStatement[]) =>
      database.transaction(() =>
        statements.map((statement) =>
          (statement as unknown as SqliteStatement).execute<T>(),
        ),
      )(),
  } as unknown as D1Database;
}

function migratedDatabase() {
  const database = new Database(':memory:');
  for (const migration of [
    '0001_create_waitlist.sql',
    '0002_index_confirmation_token.sql',
    '0003_add_confirmation_sent_at.sql',
    '0004_create_waitlist_confirmation_deliveries.sql',
    '0005_add_access_receipt.sql',
  ]) {
    applyMigration(database, migration);
  }
  return database;
}

describe('waitlist delivery migrations', () => {
  test('adds durable delivery attempts without breaking the old application', () => {
    const database = new Database(':memory:');
    applyMigration(database, '0001_create_waitlist.sql');
    applyMigration(database, '0002_index_confirmation_token.sql');
    applyMigration(database, '0003_add_confirmation_sent_at.sql');
    database
      .query(
        `INSERT INTO waitlist_subscribers (
          email, confirmation_token_hash, confirmation_expires_at,
          confirmation_sent_at
        ) VALUES (?, ?, ?, ?)`,
      )
      .run(
        'user@example.com',
        'legacy-hash',
        '2026-08-22T00:00:00.000Z',
        '2026-08-21T00:00:00.000Z',
      );

    applyMigration(
      database,
      '0004_create_waitlist_confirmation_deliveries.sql',
    );

    const legacySignup = database
      .query(
        `INSERT INTO waitlist_subscribers (
          email, status, confirmation_token_hash, confirmation_expires_at,
          confirmation_sent_at, updated_at
        ) VALUES (?, 'pending', ?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET
          status = CASE
            WHEN waitlist_subscribers.status = 'confirmed' THEN 'confirmed'
            WHEN waitlist_subscribers.confirmation_sent_at > ?
              THEN waitlist_subscribers.status
            ELSE 'pending'
          END,
          confirmation_token_hash = CASE
            WHEN waitlist_subscribers.status = 'confirmed'
              THEN waitlist_subscribers.confirmation_token_hash
            WHEN waitlist_subscribers.confirmation_sent_at > ?
              THEN waitlist_subscribers.confirmation_token_hash
            ELSE excluded.confirmation_token_hash
          END,
          confirmation_expires_at = CASE
            WHEN waitlist_subscribers.status = 'confirmed'
              THEN waitlist_subscribers.confirmation_expires_at
            WHEN waitlist_subscribers.confirmation_sent_at > ?
              THEN waitlist_subscribers.confirmation_expires_at
            ELSE excluded.confirmation_expires_at
          END,
          confirmation_sent_at = CASE
            WHEN waitlist_subscribers.status = 'confirmed'
              THEN waitlist_subscribers.confirmation_sent_at
            WHEN waitlist_subscribers.confirmation_sent_at > ?
              THEN waitlist_subscribers.confirmation_sent_at
            ELSE excluded.confirmation_sent_at
          END,
          unsubscribed_at = CASE
            WHEN waitlist_subscribers.status = 'confirmed'
              THEN waitlist_subscribers.unsubscribed_at
            ELSE NULL
          END,
          updated_at = excluded.updated_at
        RETURNING status, confirmation_token_hash = ? AS should_send`,
      )
      .get(
        'user@example.com',
        'replacement-legacy-hash',
        '2026-08-23T00:00:00.000Z',
        '2026-08-21T00:15:00.000Z',
        '2026-08-21T00:15:00.000Z',
        '2026-08-21T00:05:00.000Z',
        '2026-08-21T00:05:00.000Z',
        '2026-08-21T00:05:00.000Z',
        '2026-08-21T00:05:00.000Z',
        'replacement-legacy-hash',
      );
    expect(legacySignup).toEqual({ status: 'pending', should_send: 1 });

    expect(
      database
        .query(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name = ?`,
        )
        .get('waitlist_confirmation_deliveries'),
    ).toEqual({ name: 'waitlist_confirmation_deliveries' });
    expect(
      database
        .query(
          `SELECT confirmation_token_hash, confirmation_expires_at,
                  confirmation_sent_at
           FROM waitlist_subscribers WHERE email = ?`,
        )
        .get('user@example.com'),
    ).toEqual({
      confirmation_token_hash: 'replacement-legacy-hash',
      confirmation_expires_at: '2026-08-23T00:00:00.000Z',
      confirmation_sent_at: '2026-08-21T00:15:00.000Z',
    });

    database
      .query(
        `UPDATE waitlist_subscribers
         SET status = 'confirmed', confirmed_at = ?, updated_at = ?
         WHERE confirmation_token_hash = ?
           AND status = 'pending'
           AND confirmation_expires_at > ?`,
      )
      .run(
        '2026-08-21T00:01:00.000Z',
        '2026-08-21T00:01:00.000Z',
        'replacement-legacy-hash',
        '2026-08-21T00:01:00.000Z',
      );
    expect(
      database
        .query('SELECT status FROM waitlist_subscribers WHERE email = ?')
        .get('user@example.com'),
    ).toEqual({ status: 'confirmed' });
  });
});

describe('WaitlistDeliveryStore', () => {
  test('allows only one concurrent delivery claim per cooldown window', async () => {
    const database = migratedDatabase();
    const store = new WaitlistDeliveryStore(d1(database));
    const input = {
      email: 'user@example.com',
      expiresAt: '2026-08-22T00:00:00.000Z',
      attemptedAt: '2026-08-21T00:00:00.000Z',
      cooldownSince: '2026-08-20T23:50:00.000Z',
    };

    const claims = await Promise.all([
      store.claimDeliveryAttempt({
        ...input,
        id: 'attempt-1',
        tokenHash: 'hash-1',
      }),
      store.claimDeliveryAttempt({
        ...input,
        id: 'attempt-2',
        tokenHash: 'hash-2',
      }),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(
      database
        .query('SELECT count(*) AS count FROM waitlist_confirmation_deliveries')
        .get(),
    ).toEqual({ count: 1 });
  });

  test('does not start cooldown for a definitely rejected attempt', async () => {
    const database = migratedDatabase();
    const store = new WaitlistDeliveryStore(d1(database));
    const attemptedAt = '2026-08-21T00:00:00.000Z';
    expect(
      await store.claimDeliveryAttempt({
        id: 'rejected',
        email: 'user@example.com',
        tokenHash: 'rejected-hash',
        expiresAt: '2026-08-22T00:00:00.000Z',
        attemptedAt,
        cooldownSince: '2026-08-20T23:50:00.000Z',
      }),
    ).toBe(true);
    await store.markRejected('rejected', 'E_RECIPIENT_SUPPRESSED', attemptedAt);

    expect(
      await store.claimDeliveryAttempt({
        id: 'retry',
        email: 'user@example.com',
        tokenHash: 'retry-hash',
        expiresAt: '2026-08-22T00:01:00.000Z',
        attemptedAt: '2026-08-21T00:01:00.000Z',
        cooldownSince: '2026-08-20T23:51:00.000Z',
      }),
    ).toBe(true);
    expect(await store.confirmToken('rejected-hash', attemptedAt)).toBeNull();
  });

  test('keeps retryable provider limits under cooldown without confirming', async () => {
    const database = migratedDatabase();
    const store = new WaitlistDeliveryStore(d1(database));
    const attemptedAt = '2026-08-21T00:00:00.000Z';
    await store.claimDeliveryAttempt({
      id: 'retryable',
      email: 'user@example.com',
      tokenHash: 'retryable-hash',
      expiresAt: '2026-08-22T00:00:00.000Z',
      attemptedAt,
      cooldownSince: '2026-08-20T23:50:00.000Z',
    });

    await store.markRetryable(
      'retryable',
      'E_RATE_LIMIT_EXCEEDED',
      attemptedAt,
    );

    expect(
      await store.claimDeliveryAttempt({
        id: 'blocked-retry',
        email: 'user@example.com',
        tokenHash: 'blocked-retry-hash',
        expiresAt: '2026-08-22T00:01:00.000Z',
        attemptedAt: '2026-08-21T00:01:00.000Z',
        cooldownSince: '2026-08-20T23:51:00.000Z',
      }),
    ).toBe(false);
    expect(
      await store.claimDeliveryAttempt({
        id: 'other-address-blocked',
        email: 'other@example.com',
        tokenHash: 'other-address-blocked-hash',
        expiresAt: '2026-08-22T00:01:00.000Z',
        attemptedAt: '2026-08-21T00:01:00.000Z',
        cooldownSince: '2026-08-20T23:51:00.000Z',
      }),
    ).toBe(false);
    expect(
      await store.claimDeliveryAttempt({
        id: 'after-provider-backoff',
        email: 'user@example.com',
        tokenHash: 'after-provider-backoff-hash',
        expiresAt: '2026-08-22T00:11:00.000Z',
        attemptedAt: '2026-08-21T00:11:00.000Z',
        cooldownSince: '2026-08-21T00:01:00.000Z',
      }),
    ).toBe(true);
    expect(await store.confirmToken('retryable-hash', attemptedAt)).toBeNull();
  });

  test('keeps an ambiguous attempt valid while blocking cooldown duplicates', async () => {
    const database = migratedDatabase();
    const store = new WaitlistDeliveryStore(d1(database));
    const attemptedAt = '2026-08-21T00:00:00.000Z';
    await store.claimDeliveryAttempt({
      id: 'unknown',
      email: 'user@example.com',
      tokenHash: 'unknown-hash',
      expiresAt: '2026-08-22T00:00:00.000Z',
      attemptedAt,
      cooldownSince: '2026-08-20T23:50:00.000Z',
    });
    await store.markUnknown('unknown', 'E_INTERNAL_SERVER_ERROR', attemptedAt);

    expect(
      await store.claimDeliveryAttempt({
        id: 'duplicate',
        email: 'user@example.com',
        tokenHash: 'duplicate-hash',
        expiresAt: '2026-08-22T00:01:00.000Z',
        attemptedAt: '2026-08-21T00:01:00.000Z',
        cooldownSince: '2026-08-20T23:51:00.000Z',
      }),
    ).toBe(false);
    expect(await store.confirmToken('unknown-hash', attemptedAt)).toEqual({
      email: 'user@example.com',
    });
    expect(
      database
        .query(
          'SELECT state FROM waitlist_confirmation_deliveries WHERE id = ?',
        )
        .get('unknown'),
    ).toEqual({ state: 'accepted' });
  });

  test('preserves a previous accepted token after a later attempt is rejected', async () => {
    const database = migratedDatabase();
    const store = new WaitlistDeliveryStore(d1(database));
    await store.claimDeliveryAttempt({
      id: 'accepted',
      email: 'user@example.com',
      tokenHash: 'accepted-hash',
      expiresAt: '2026-08-23T00:00:00.000Z',
      attemptedAt: '2026-08-20T00:00:00.000Z',
      cooldownSince: '2026-08-19T23:50:00.000Z',
    });
    await store.markAccepted(
      'accepted',
      'provider-message',
      '2026-08-20T00:00:01.000Z',
    );
    await store.claimDeliveryAttempt({
      id: 'later-rejected',
      email: 'user@example.com',
      tokenHash: 'later-rejected-hash',
      expiresAt: '2026-08-24T00:00:00.000Z',
      attemptedAt: '2026-08-22T00:00:00.000Z',
      cooldownSince: '2026-08-21T23:50:00.000Z',
    });
    await store.markRejected(
      'later-rejected',
      'E_DELIVERY_FAILED',
      '2026-08-22T00:00:01.000Z',
    );

    expect(
      await store.confirmToken('accepted-hash', '2026-08-22T12:00:00.000Z'),
    ).toEqual({ email: 'user@example.com' });
  });

  test('rejects expired and already-consumed confirmation tokens', async () => {
    const database = migratedDatabase();
    const store = new WaitlistDeliveryStore(d1(database));
    await store.claimDeliveryAttempt({
      id: 'expired',
      email: 'expired@example.com',
      tokenHash: 'expired-hash',
      expiresAt: '2026-08-21T01:00:00.000Z',
      attemptedAt: '2026-08-21T00:00:00.000Z',
      cooldownSince: '2026-08-20T23:50:00.000Z',
    });
    await store.markAccepted(
      'expired',
      'expired-provider-message',
      '2026-08-21T00:00:01.000Z',
    );
    expect(
      await store.confirmToken('expired-hash', '2026-08-21T01:00:00.000Z'),
    ).toBeNull();

    await store.claimDeliveryAttempt({
      id: 'consumed',
      email: 'consumed@example.com',
      tokenHash: 'consumed-hash',
      expiresAt: '2026-08-22T00:00:00.000Z',
      attemptedAt: '2026-08-21T00:00:00.000Z',
      cooldownSince: '2026-08-20T23:50:00.000Z',
    });
    await store.markAccepted(
      'consumed',
      'consumed-provider-message',
      '2026-08-21T00:00:01.000Z',
    );
    expect(
      await store.confirmToken('consumed-hash', '2026-08-21T00:30:00.000Z'),
    ).toEqual({ email: 'consumed@example.com' });
    expect(
      await store.confirmToken('consumed-hash', '2026-08-21T00:31:00.000Z'),
    ).toBeNull();
    expect(
      database
        .query('SELECT status FROM waitlist_subscribers WHERE email = ?')
        .get('consumed@example.com'),
    ).toEqual({ status: 'confirmed' });
  });

  test('keeps unsubscribed and confirmed subscribers terminal for signup claims', async () => {
    const database = migratedDatabase();
    const store = new WaitlistDeliveryStore(d1(database));
    database
      .query(
        `INSERT INTO waitlist_subscribers (email, status)
         VALUES ('unsubscribed@example.com', 'unsubscribed'),
                ('confirmed@example.com', 'confirmed')`,
      )
      .run();

    for (const [id, email] of [
      ['unsubscribed', 'unsubscribed@example.com'],
      ['confirmed', 'confirmed@example.com'],
    ]) {
      expect(
        await store.claimDeliveryAttempt({
          id,
          email,
          tokenHash: `${id}-hash`,
          expiresAt: '2026-08-22T00:00:00.000Z',
          attemptedAt: '2026-08-21T00:00:00.000Z',
          cooldownSince: '2026-08-20T23:50:00.000Z',
        }),
      ).toBe(false);
    }
  });

  test('gates Discord access behind a receipt committed with the transition', async () => {
    const database = migratedDatabase();
    const store = new WaitlistDeliveryStore(d1(database));

    // Without a receipt the confirmed subscriber has no page access.
    await store.claimDeliveryAttempt({
      id: 'attempt',
      email: 'user@example.com',
      tokenHash: 'token-hash',
      expiresAt: '2026-08-23T13:00:00.000Z',
      attemptedAt: '2026-08-22T12:00:00.000Z',
      cooldownSince: '2026-08-22T11:50:00.000Z',
    });
    await store.markAccepted('attempt', 'message', '2026-08-22T12:00:01.000Z');
    expect(
      await store.confirmToken('token-hash', '2026-08-22T12:05:00.000Z'),
    ).toEqual({ email: 'user@example.com' });
    expect(
      await store.hasValidAccessReceipt(
        'receipt-hash',
        '2026-08-22T12:06:00.000Z',
      ),
    ).toBe(false);

    // A receipted confirmation grants access in the same commit, bounded by
    // its expiry and keyed to its own hash. A different subscriber's receipt
    // never matches.
    await store.claimDeliveryAttempt({
      id: 'attempt-receipted',
      email: 'pending@example.com',
      tokenHash: 'receipted-token-hash',
      expiresAt: '2026-08-24T13:00:00.000Z',
      attemptedAt: '2026-08-23T12:00:00.000Z',
      cooldownSince: '2026-08-23T11:50:00.000Z',
    });
    await store.markAccepted(
      'attempt-receipted',
      'message-2',
      '2026-08-23T12:00:01.000Z',
    );
    expect(
      await store.confirmToken(
        'receipted-token-hash',
        '2026-08-23T12:05:00.000Z',
        { hash: 'receipt-hash', expiresAt: '2026-08-24T12:05:00.000Z' },
      ),
    ).toEqual({ email: 'pending@example.com' });
    expect(
      await store.hasValidAccessReceipt(
        'receipt-hash',
        '2026-08-23T12:04:00.000Z',
      ),
    ).toBe(true);
    expect(
      await store.hasValidAccessReceipt(
        'receipt-hash',
        '2026-08-24T12:05:01.000Z',
      ),
    ).toBe(false);
    expect(
      await store.hasValidAccessReceipt(
        'other-hash',
        '2026-08-23T12:04:00.000Z',
      ),
    ).toBe(false);
  });

  test('reports missing and incompatible delivery transitions', async () => {
    const database = migratedDatabase();
    const store = new WaitlistDeliveryStore(d1(database));

    await expect(
      store.markAccepted('missing', 'provider-message', '2026-08-21T00:00:00Z'),
    ).rejects.toMatchObject({ code: 'DELIVERY_STATE_CONFLICT' });

    await store.claimDeliveryAttempt({
      id: 'unknown',
      email: 'user@example.com',
      tokenHash: 'unknown-transition-hash',
      expiresAt: '2026-08-22T00:00:00.000Z',
      attemptedAt: '2026-08-21T00:00:00.000Z',
      cooldownSince: '2026-08-20T23:50:00.000Z',
    });
    await store.markUnknown(
      'unknown',
      'E_INTERNAL_SERVER_ERROR',
      '2026-08-21T00:00:01Z',
    );

    await expect(
      store.markRejected(
        'unknown',
        'E_DELIVERY_FAILED',
        '2026-08-21T00:00:02Z',
      ),
    ).rejects.toMatchObject({ code: 'DELIVERY_STATE_CONFLICT' });
  });

  test('rejects idempotent transitions with conflicting provider metadata', async () => {
    const database = migratedDatabase();
    const store = new WaitlistDeliveryStore(d1(database));
    await store.claimDeliveryAttempt({
      id: 'accepted-metadata',
      email: 'accepted@example.com',
      tokenHash: 'accepted-metadata-hash',
      expiresAt: '2026-08-22T00:00:00.000Z',
      attemptedAt: '2026-08-21T00:00:00.000Z',
      cooldownSince: '2026-08-20T23:50:00.000Z',
    });
    await store.markAccepted(
      'accepted-metadata',
      'provider-message-1',
      '2026-08-21T00:00:01.000Z',
    );
    expect(
      database
        .query(
          `SELECT state, provider_message_id, failure_code, state_changed_at
           FROM waitlist_confirmation_deliveries WHERE id = ?`,
        )
        .get('accepted-metadata'),
    ).toEqual({
      state: 'accepted',
      provider_message_id: 'provider-message-1',
      failure_code: null,
      state_changed_at: '2026-08-21T00:00:01.000Z',
    });

    await expect(
      store.markAccepted(
        'accepted-metadata',
        'provider-message-2',
        '2026-08-21T00:00:02.000Z',
      ),
    ).rejects.toMatchObject({ code: 'DELIVERY_STATE_CONFLICT' });
  });
});
