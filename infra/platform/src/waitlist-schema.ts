import { defineRelations, sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const isoNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

const nocaseText = customType<{ data: string }>({
  dataType() {
    return 'TEXT COLLATE NOCASE';
  },
});

/** Waitlist subscriber keyed by case-insensitive email. */
export const waitlistSubscribers = sqliteTable(
  'waitlist_subscribers',
  {
    email: nocaseText('email').primaryKey(),
    status: text('status').notNull().default('pending'),
    confirmationTokenHash: text('confirmation_token_hash'),
    confirmationExpiresAt: text('confirmation_expires_at'),
    confirmedAt: text('confirmed_at'),
    unsubscribedAt: text('unsubscribed_at'),
    createdAt: text('created_at').notNull().default(isoNow),
    updatedAt: text('updated_at').notNull().default(isoNow),
    confirmationSentAt: text('confirmation_sent_at'),
    accessReceiptHash: text('access_receipt_hash'),
    accessReceiptExpiresAt: text('access_receipt_expires_at'),
  },
  (table) => [
    check(
      'waitlist_subscribers_status_check',
      sql`${table.status} IN ('pending', 'confirmed', 'unsubscribed')`,
    ),
    index('waitlist_subscribers_status_created_at').on(
      table.status,
      table.createdAt,
    ),
    uniqueIndex('waitlist_subscribers_confirmation_token_hash')
      .on(table.confirmationTokenHash)
      .where(sql`${table.confirmationTokenHash} IS NOT NULL`),
    index('waitlist_subscribers_access_receipt').on(table.accessReceiptHash),
  ],
);

/** Independent confirmation-attempt ledger. */
export const waitlistConfirmationDeliveries = sqliteTable(
  'waitlist_confirmation_deliveries',
  {
    id: text('id').primaryKey(),
    email: nocaseText('email')
      .notNull()
      .references(() => waitlistSubscribers.email, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: text('expires_at').notNull(),
    state: text('state').notNull(),
    attemptedAt: text('attempted_at').notNull(),
    stateChangedAt: text('state_changed_at').notNull(),
    providerMessageId: text('provider_message_id'),
    failureCode: text('failure_code'),
  },
  (table) => [
    check(
      'waitlist_confirmation_deliveries_state_check',
      sql`${table.state} IN ('attempting', 'accepted', 'rejected', 'retryable', 'unknown')`,
    ),
    index('waitlist_confirmation_deliveries_email_attempted_at').on(
      table.email,
      sql`${table.attemptedAt} DESC`,
    ),
  ],
);

/** Confirmed-subscriber invitation resend ledger. */
export const waitlistResendDeliveries = sqliteTable(
  'waitlist_resend_deliveries',
  {
    id: text('id').primaryKey(),
    email: nocaseText('email')
      .notNull()
      .references(() => waitlistSubscribers.email, { onDelete: 'cascade' }),
    state: text('state').notNull(),
    attemptedAt: text('attempted_at').notNull(),
    stateChangedAt: text('state_changed_at').notNull(),
    providerMessageId: text('provider_message_id'),
    failureCode: text('failure_code'),
  },
  (table) => [
    check(
      'waitlist_resend_deliveries_state_check',
      sql`${table.state} IN ('attempting', 'accepted', 'rejected', 'retryable', 'unknown')`,
    ),
    index('waitlist_resend_deliveries_email_attempted_at').on(
      table.email,
      sql`${table.attemptedAt} DESC`,
    ),
  ],
);

/** Provider-wide email send backoff. A single row blocks every signup. */
export const waitlistDeliveryBackoffs = sqliteTable(
  'waitlist_delivery_backoffs',
  {
    provider: text('provider').primaryKey(),
    retryAfter: text('retry_after').notNull(),
    failureCode: text('failure_code').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    check(
      'waitlist_delivery_backoffs_provider_check',
      sql`${table.provider} = 'email'`,
    ),
  ],
);

/** Typed joins for `db.query.*`. Does not change generated SQL. */
export const waitlistRelations = defineRelations(
  {
    waitlistSubscribers,
    waitlistConfirmationDeliveries,
    waitlistResendDeliveries,
    waitlistDeliveryBackoffs,
  },
  (r) => ({
    waitlistSubscribers: {
      confirmationDeliveries: r.many.waitlistConfirmationDeliveries(),
      resendDeliveries: r.many.waitlistResendDeliveries(),
    },
    waitlistConfirmationDeliveries: {
      subscriber: r.one.waitlistSubscribers({
        from: r.waitlistConfirmationDeliveries.email,
        to: r.waitlistSubscribers.email,
        optional: false,
      }),
    },
    waitlistResendDeliveries: {
      subscriber: r.one.waitlistSubscribers({
        from: r.waitlistResendDeliveries.email,
        to: r.waitlistSubscribers.email,
        optional: false,
      }),
    },
  }),
);
