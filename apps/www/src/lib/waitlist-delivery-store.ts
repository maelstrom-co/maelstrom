export interface ClaimDeliveryAttempt {
  id: string;
  email: string;
  tokenHash: string;
  expiresAt: string;
  attemptedAt: string;
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

    const [, confirmation] = await this.database.batch<{ email: string }>([
      acceptAttempt,
      confirmSubscriber,
    ]);
    return confirmation?.results[0] ?? null;
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

class DeliveryStateConflictError extends Error {
  readonly code = 'DELIVERY_STATE_CONFLICT';

  constructor() {
    super('Delivery attempt is missing or has an incompatible state');
    this.name = 'DeliveryStateConflictError';
  }
}
