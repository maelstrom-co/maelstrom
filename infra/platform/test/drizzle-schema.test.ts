import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { waitlistRelations } from '../src/waitlist-schema.js';

const workspaceRoot = resolve(import.meta.dirname, '../../..');
const legacyMigrationsDir = resolve(import.meta.dirname, '../migrations');
const drizzleMigrationsDir = resolve(
  import.meta.dirname,
  '../drizzle/migrations',
);
const DRIZZLE_PIN = '1.0.0-rc.5-ab785fc';

const applySql = (database: Database, sql: string) => {
  for (const statement of sql.split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) database.exec(trimmed);
  }
};

const applyLegacy = (database: Database) => {
  for (const name of readdirSync(legacyMigrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    database.exec(readFileSync(resolve(legacyMigrationsDir, name), 'utf8'));
  }
};

const drizzleSqlFiles = () =>
  readdirSync(drizzleMigrationsDir, { withFileTypes: true })
    .flatMap((entry) => {
      if (entry.isFile() && entry.name.endsWith('.sql')) {
        return [resolve(drizzleMigrationsDir, entry.name)];
      }
      if (!entry.isDirectory()) return [];
      return readdirSync(resolve(drizzleMigrationsDir, entry.name))
        .filter((file) => file.endsWith('.sql'))
        .map((file) => resolve(drizzleMigrationsDir, entry.name, file));
    })
    .sort();

const applyDrizzle = (database: Database) => {
  database.exec('PRAGMA foreign_keys = ON');
  const files = drizzleSqlFiles();
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    applySql(database, readFileSync(file, 'utf8'));
  }
};

type ColumnRow = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

type IndexRow = {
  name: string;
  unique: number;
  origin: string;
  partial: number;
};

const schemaDump = (database: Database) => {
  const tables = database
    .query(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all() as Array<{ name: string }>;

  return tables.map(({ name }) => {
    const columns = (
      database.query(`PRAGMA table_info(${name})`).all() as ColumnRow[]
    ).map((column) => ({
      name: column.name,
      type: column.type.toUpperCase(),
      notnull: column.notnull,
      pk: column.pk,
      dflt_value: column.dflt_value,
    }));
    const indexes = (
      database.query(`PRAGMA index_list(${name})`).all() as IndexRow[]
    )
      .filter((index) => !index.name.startsWith('sqlite_autoindex_'))
      .map((index) => {
        const sql = (
          database
            .query(`SELECT sql FROM sqlite_master WHERE name = ?`)
            .get(index.name) as { sql: string | null } | null
        )?.sql;
        const columns = (
          database.query(`PRAGMA index_info(${index.name})`).all() as Array<{
            name: string;
          }>
        ).map((column) => column.name);
        return {
          name: index.name,
          unique: index.unique,
          partial: index.partial,
          columns,
          descending: /desc/i.test(sql ?? ''),
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
    const foreignKeys = (
      database.query(`PRAGMA foreign_key_list(${name})`).all() as Array<{
        table: string;
        from: string;
        to: string;
        on_delete: string;
      }>
    ).map((key) => ({
      table: key.table,
      from: key.from,
      to: key.to,
      on_delete: key.on_delete.toUpperCase(),
    }));
    const createSql = (
      database
        .query(
          `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
        )
        .get(name) as { sql: string }
    ).sql;
    const checks = [...createSql.matchAll(/CHECK\s*\((.*)\)/gi)].map((match) =>
      match[1].replaceAll('"', '').replaceAll('`', '').replace(/\s+/g, ' '),
    );
    const nocaseColumns = [
      ...createSql.matchAll(/[`"]?(\w+)[`"]?[^,)]*COLLATE NOCASE/gi),
    ].map((match) => match[1]);
    return { name, columns, indexes, foreignKeys, checks, nocaseColumns };
  });
};

describe('Drizzle waitlist schema', () => {
  test('pins drizzle-orm and drizzle-kit to the approved rc', () => {
    const packageJson = JSON.parse(
      readFileSync(
        resolve(workspaceRoot, 'infra/platform/package.json'),
        'utf8',
      ),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
    expect(dependencies['drizzle-orm']).toBe(DRIZZLE_PIN);
    expect(dependencies['drizzle-kit']).toBe(DRIZZLE_PIN);
    expect(
      (
        packageJson as {
          exports?: Record<string, string>;
        }
      ).exports?.['./waitlist-schema'],
    ).toBe('./src/waitlist-schema.ts');
  });

  test('owns only the live Drizzle waitlist database', () => {
    const waitlist = readFileSync(
      resolve(workspaceRoot, 'infra/platform/src/Waitlist.ts'),
      'utf8',
    );
    const deploy = readFileSync(
      resolve(workspaceRoot, '.github/workflows/deploy-production.yml'),
      'utf8',
    );
    const stack = readFileSync(
      resolve(workspaceRoot, 'infra/platform/alchemy.run.ts'),
      'utf8',
    );
    expect(waitlist).toContain("D1.Database('WaitlistNext'");
    expect(waitlist).toContain('../drizzle/migrations');
    expect(waitlist).toContain(
      "WAITLIST_DATABASE_NAME = 'maelstrom-waitlist-v2'",
    );
    expect(waitlist).not.toContain("D1.Database('Waitlist'");
    expect(waitlist).not.toContain('WAITLIST_NEXT_DATABASE_NAME');
    expect(waitlist).not.toContain('../migrations');
    expect(waitlist).not.toContain('Drizzle.Schema');
    expect(stack).not.toContain('Drizzle.providers');
    expect(stack).not.toContain('waitlistNextDatabase');
    expect(waitlist).toContain("Database.ref('WaitlistNext',");
    expect(waitlist).not.toContain("Database.ref('Waitlist',");
    expect(deploy).not.toContain('drizzle-kit generate');
    expect(deploy).not.toContain('db:generate');
  });

  test('reproduces the live waitlist schema including receipt columns', () => {
    const legacy = new Database(':memory:');
    const drizzle = new Database(':memory:');
    applyLegacy(legacy);
    applyDrizzle(drizzle);
    expect(schemaDump(drizzle)).toEqual(schemaDump(legacy));
  });

  test('joins subscribers to both delivery ledgers', async () => {
    const database = new Database(':memory:');
    applyDrizzle(database);
    database.exec(`
      INSERT INTO waitlist_subscribers (email) VALUES ('user@example.com');
      INSERT INTO waitlist_confirmation_deliveries (
        id, email, token_hash, expires_at, state, attempted_at, state_changed_at
      ) VALUES (
        'confirmation', 'user@example.com', 'token-hash',
        '2026-08-25T01:00:00.000Z', 'attempting',
        '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z'
      );
      INSERT INTO waitlist_resend_deliveries (
        id, email, state, attempted_at, state_changed_at
      ) VALUES (
        'resend', 'user@example.com', 'attempting',
        '2026-08-25T00:05:00.000Z', '2026-08-25T00:05:00.000Z'
      );
      INSERT INTO waitlist_delivery_backoffs (
        provider, retry_after, failure_code, updated_at
      ) VALUES (
        'email', '2026-08-25T00:15:00.000Z', 'E_DELIVERY_FAILED',
        '2026-08-25T00:05:00.000Z'
      );
    `);
    const db = drizzle({ client: database, relations: waitlistRelations });

    const subscriber = await db.query.waitlistSubscribers.findFirst({
      where: { email: 'user@example.com' },
      with: { confirmationDeliveries: true, resendDeliveries: true },
    });
    const confirmation =
      await db.query.waitlistConfirmationDeliveries.findFirst({
        where: { id: 'confirmation' },
        with: { subscriber: true },
      });
    const resend = await db.query.waitlistResendDeliveries.findFirst({
      where: { id: 'resend' },
      with: { subscriber: true },
    });
    const backoff = await db.query.waitlistDeliveryBackoffs.findFirst();

    expect(subscriber?.confirmationDeliveries).toHaveLength(1);
    expect(subscriber?.resendDeliveries).toHaveLength(1);
    expect(confirmation?.subscriber.email).toBe('user@example.com');
    expect(resend?.subscriber.email).toBe('user@example.com');
    expect(backoff?.provider).toBe('email');
  });
});
