export interface ClaimDeliveryAttempt {
  id: string;
  email: string;
  tokenHash: string;
  expiresAt: string;
  attemptedAt: string;
  cooldownSince: string;
}

/** Inputs for the single-statement confirmed-subscriber resend claim. */
export interface ClaimResendAttempt {
  id: string;
  email: string;
  attemptedAt: string;
  /** Attempts newer than this exclusive boundary suppress the claim. */
  cooldownSince: string;
}

const EMAIL_RETRY_BACKOFF_MS = 10 * 60 * 1000;
const EMAIL_DAILY_LIMIT_BACKOFF_MS = 60 * 60 * 1000;

export class WaitlistDeliveryStore {
  constructor(private readonly database: D1Database) {}

  async claimDeliveryAttempt(input: ClaimDeliveryAttempt): Promise<boolean> {
    await this.database
      .prepare(
        `INSERT OR IGNORE INTO waitlist_subscribers (
          email, status, updated_at
        ) VALUES (?, 'pending', ?)`,
      )
      .bind(input.email, input.attemptedAt)
      .run();

    const attempt = await this.database
      .prepare(
        `INSERT INTO waitlist_confirmation_deliveries (
          id, email, token_hash, expires_at, state, attempted_at,
          state_changed_at
        )
        SELECT ?, email, ?, ?, 'attempting', ?, ?
        FROM waitlist_subscribers
        WHERE email = ?
          AND status = 'pending'
          AND NOT EXISTS (
            SELECT 1 FROM waitlist_delivery_backoffs
            WHERE provider = 'email' AND retry_after > ?
          )
          AND NOT EXISTS (
            SELECT 1
            FROM waitlist_confirmation_deliveries
            WHERE email = ?
              AND state NOT IN ('rejected', 'retryable')
              AND attempted_at > ?
          )
        RETURNING id`,
      )
      .bind(
        input.id,
        input.tokenHash,
        input.expiresAt,
        input.attemptedAt,
        input.attemptedAt,
        input.email,
        input.attemptedAt,
        input.email,
        input.cooldownSince,
      )
      .first<{ id: string }>();
    return attempt !== null;
  }

  /** Atomically claims a confirmed subscriber when cooldowns permit delivery. */
  async claimResendAttempt(input: ClaimResendAttempt): Promise<boolean> {
    const attempt = await this.database
      .prepare(
        `INSERT INTO waitlist_resend_deliveries (
          id, email, state, attempted_at, state_changed_at
        )
        SELECT ?, email, 'attempting', ?, ?
        FROM waitlist_subscribers
        WHERE email = ?
          AND status = 'confirmed'
          AND NOT EXISTS (
            SELECT 1 FROM waitlist_resend_deliveries
            WHERE email = ? AND attempted_at > ?
          )
          AND NOT EXISTS (
            SELECT 1 FROM waitlist_delivery_backoffs
            WHERE provider = 'email' AND retry_after > ?
          )
        RETURNING id`,
      )
      .bind(
        input.id,
        input.attemptedAt,
        input.attemptedAt,
        input.email,
        input.email,
        input.cooldownSince,
        input.attemptedAt,
      )
      .first<{ id: string }>();
    return attempt !== null;
  }

  /** Settles an attempting resend with the provider message identifier. */
  async markResendAccepted(
    id: string,
    messageId: string,
    changedAt: string,
  ): Promise<void> {
    await this.resendTransition(id, 'accepted', changedAt, messageId, null);
  }

  /** Settles an attempting resend after a definite provider rejection. */
  async markResendRejected(
    id: string,
    failureCode: string,
    changedAt: string,
  ): Promise<void> {
    await this.resendTransition(id, 'rejected', changedAt, null, failureCode);
  }

  /** Settles an attempting resend whose provider outcome is ambiguous. */
  async markResendUnknown(
    id: string,
    failureCode: string,
    changedAt: string,
  ): Promise<void> {
    await this.resendTransition(id, 'unknown', changedAt, null, failureCode);
  }

  /**
   * Settles an attempting resend and atomically extends the global provider
   * backoff. Exact replays do not move the existing retry boundary.
   */
  async markResendRetryable(
    id: string,
    failureCode: string,
    changedAt: string,
  ): Promise<void> {
    const changedTime = Date.parse(changedAt);
    if (
      !Number.isFinite(changedTime) ||
      new Date(changedTime).toISOString() !== changedAt
    ) {
      throw new Error('changedAt must be a canonical ISO timestamp');
    }
    const backoffMs =
      failureCode === 'E_DAILY_LIMIT_EXCEEDED'
        ? EMAIL_DAILY_LIMIT_BACKOFF_MS
        : EMAIL_RETRY_BACKOFF_MS;
    const retryAfter = new Date(changedTime + backoffMs).toISOString();
    const transition = this.database
      .prepare(
        `UPDATE waitlist_resend_deliveries
         SET state = 'retryable', state_changed_at = ?,
             provider_message_id = NULL, failure_code = ?
         WHERE id = ? AND state = 'attempting'
         RETURNING state`,
      )
      .bind(changedAt, failureCode, id);
    const providerBackoff = this.database
      .prepare(
        `INSERT INTO waitlist_delivery_backoffs (
           provider, retry_after, failure_code, updated_at
         )
         SELECT 'email', ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM waitlist_resend_deliveries
           WHERE id = ? AND state = 'retryable' AND failure_code = ?
             AND state_changed_at = ?
         )
         ON CONFLICT(provider) DO UPDATE SET
           retry_after = max(waitlist_delivery_backoffs.retry_after, excluded.retry_after),
           failure_code = excluded.failure_code,
           updated_at = excluded.updated_at`,
      )
      .bind(retryAfter, failureCode, changedAt, id, failureCode, changedAt);
    const [updated] = await this.database.batch<{ state: string }>([
      transition,
      providerBackoff,
    ]);
    if ((updated?.results.length ?? 0) === 1) return;
    await this.assertExistingResendTransition(
      id,
      'retryable',
      null,
      failureCode,
    );
  }

  async markAccepted(
    id: string,
    messageId: string,
    changedAt: string,
  ): Promise<void> {
    await this.transition(id, 'accepted', changedAt, messageId, null);
  }

  async markRejected(
    id: string,
    failureCode: string,
    changedAt: string,
  ): Promise<void> {
    await this.transition(id, 'rejected', changedAt, null, failureCode);
  }

  async markUnknown(
    id: string,
    failureCode: string,
    changedAt: string,
  ): Promise<void> {
    await this.transition(id, 'unknown', changedAt, null, failureCode);
  }

  async markRetryable(
    id: string,
    failureCode: string,
    changedAt: string,
  ): Promise<void> {
    const changedTime = Date.parse(changedAt);
    if (
      !Number.isFinite(changedTime) ||
      new Date(changedTime).toISOString() !== changedAt
    ) {
      throw new Error('changedAt must be a canonical ISO timestamp');
    }
    const backoffMs =
      failureCode === 'E_DAILY_LIMIT_EXCEEDED'
        ? EMAIL_DAILY_LIMIT_BACKOFF_MS
        : EMAIL_RETRY_BACKOFF_MS;
    const retryAfter = new Date(changedTime + backoffMs).toISOString();
    const transition = this.database
      .prepare(
        `UPDATE waitlist_confirmation_deliveries
         SET state = 'retryable', state_changed_at = ?,
             provider_message_id = NULL, failure_code = ?
         WHERE id = ? AND state = 'attempting'
         RETURNING state`,
      )
      .bind(changedAt, failureCode, id);
    const providerBackoff = this.database
      .prepare(
        `INSERT INTO waitlist_delivery_backoffs (
           provider, retry_after, failure_code, updated_at
         )
         SELECT 'email', ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM waitlist_confirmation_deliveries
           WHERE id = ? AND state = 'retryable' AND failure_code = ?
         )
         ON CONFLICT(provider) DO UPDATE SET
           retry_after = max(waitlist_delivery_backoffs.retry_after, excluded.retry_after),
           failure_code = excluded.failure_code,
           updated_at = excluded.updated_at`,
      )
      .bind(retryAfter, failureCode, changedAt, id, failureCode);
    const [updated] = await this.database.batch<{ state: string }>([
      transition,
      providerBackoff,
    ]);
    if ((updated?.results.length ?? 0) === 1) return;
    await this.assertExistingTransition(id, 'retryable', null, failureCode);
  }

  async confirmToken(
    tokenHash: string,
    now: string,
    receipt?: { hash: string; expiresAt: string },
  ): Promise<{ email: string } | null> {
    const acceptAttempt = this.database
      .prepare(
        `UPDATE waitlist_confirmation_deliveries
        SET state = 'accepted', state_changed_at = ?, failure_code = NULL
        WHERE token_hash = ?
          AND expires_at > ?
          AND state IN ('attempting', 'accepted', 'unknown')
          AND EXISTS (
            SELECT 1 FROM waitlist_subscribers
            WHERE email = waitlist_confirmation_deliveries.email
              AND status = 'pending'
          )`,
      )
      .bind(now, tokenHash, now);
    const confirmSubscriber = this.database
      .prepare(
        `UPDATE waitlist_subscribers
        SET status = 'confirmed',
            confirmation_token_hash = NULL,
            confirmation_expires_at = NULL,
            confirmation_sent_at = NULL,
            confirmed_at = ?,
            updated_at = ?
        WHERE status = 'pending'
          AND email = (
            SELECT email FROM waitlist_confirmation_deliveries
            WHERE token_hash = ?
              AND expires_at > ?
              AND state = 'accepted'
          )
        RETURNING email`,
      )
      .bind(now, now, tokenHash, now);

    // The receipt rides the same transaction as the transition: a confirmed
    // subscriber can never exist without their page-access receipt.
    const statements: D1PreparedStatement[] = [
      acceptAttempt,
      confirmSubscriber,
    ];
    if (receipt) {
      statements.push(
        this.database
          .prepare(
            `UPDATE waitlist_subscribers
            SET access_receipt_hash = ?, access_receipt_expires_at = ?, updated_at = ?
            WHERE email = (
              SELECT email FROM waitlist_confirmation_deliveries
              WHERE token_hash = ? AND expires_at > ? AND state = 'accepted'
            ) AND status = 'confirmed'`,
          )
          .bind(receipt.hash, receipt.expiresAt, now, tokenHash, now),
      );
    }

    const [, confirmation] = await this.database.batch<{ email: string }>(
      statements,
    );
    return confirmation?.results[0] ?? null;
  }

  async hasValidAccessReceipt(
    receiptHash: string,
    now: string,
  ): Promise<boolean> {
    const match = await this.database
      .prepare(
        `SELECT 1 FROM waitlist_subscribers
        WHERE access_receipt_hash = ? AND access_receipt_expires_at > ?`,
      )
      .bind(receiptHash, now)
      .first<{ 1: number }>();
    return match !== null;
  }

  private async transition(
    id: string,
    state: 'accepted' | 'rejected' | 'retryable' | 'unknown',
    changedAt: string,
    messageId: string | null,
    failureCode: string | null,
  ): Promise<void> {
    const updated = await this.database
      .prepare(
        `UPDATE waitlist_confirmation_deliveries
        SET state = ?, state_changed_at = ?, provider_message_id = ?,
            failure_code = ?
        WHERE id = ? AND state = 'attempting'
        RETURNING state`,
      )
      .bind(state, changedAt, messageId, failureCode, id)
      .first<{ state: string }>();
    if (updated) return;

    await this.assertExistingTransition(id, state, messageId, failureCode);
  }

  private async resendTransition(
    id: string,
    state: 'accepted' | 'rejected' | 'unknown',
    changedAt: string,
    messageId: string | null,
    failureCode: string | null,
  ): Promise<void> {
    const updated = await this.database
      .prepare(
        `UPDATE waitlist_resend_deliveries
         SET state = ?, state_changed_at = ?, provider_message_id = ?,
             failure_code = ?
         WHERE id = ? AND state = 'attempting'
         RETURNING state`,
      )
      .bind(state, changedAt, messageId, failureCode, id)
      .first<{ state: string }>();
    if (updated) return;
    await this.assertExistingResendTransition(
      id,
      state,
      messageId,
      failureCode,
    );
  }

  private async assertExistingResendTransition(
    id: string,
    state: 'accepted' | 'rejected' | 'retryable' | 'unknown',
    messageId: string | null,
    failureCode: string | null,
  ): Promise<void> {
    const current = await this.database
      .prepare(
        `SELECT state, provider_message_id, failure_code
         FROM waitlist_resend_deliveries WHERE id = ?`,
      )
      .bind(id)
      .first<{
        state: string;
        provider_message_id: string | null;
        failure_code: string | null;
      }>();
    if (
      current?.state === state &&
      current.provider_message_id === messageId &&
      current.failure_code === failureCode
    ) {
      return;
    }
    throw new DeliveryStateConflictError();
  }

  private async assertExistingTransition(
    id: string,
    state: 'accepted' | 'rejected' | 'retryable' | 'unknown',
    messageId: string | null,
    failureCode: string | null,
  ): Promise<void> {
    const current = await this.database
      .prepare(
        `SELECT state, provider_message_id, failure_code
         FROM waitlist_confirmation_deliveries WHERE id = ?`,
      )
      .bind(id)
      .first<{
        state: string;
        provider_message_id: string | null;
        failure_code: string | null;
      }>();
    if (
      current?.state === state &&
      current.provider_message_id === messageId &&
      current.failure_code === failureCode
    ) {
      return;
    }

    throw new DeliveryStateConflictError();
  }
}

/** Thrown when the attempt is missing or already in an incompatible state. */
export class DeliveryStateConflictError extends Error {
  readonly code = 'DELIVERY_STATE_CONFLICT';

  constructor() {
    super('Delivery attempt is missing or has an incompatible state');
    this.name = 'DeliveryStateConflictError';
  }
}
