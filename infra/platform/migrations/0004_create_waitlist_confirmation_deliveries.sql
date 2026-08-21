CREATE TABLE waitlist_confirmation_deliveries (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE
    REFERENCES waitlist_subscribers(email) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  state TEXT NOT NULL
    CHECK (state IN ('attempting', 'accepted', 'rejected', 'retryable', 'unknown')),
  attempted_at TEXT NOT NULL,
  state_changed_at TEXT NOT NULL,
  provider_message_id TEXT,
  failure_code TEXT
);

CREATE INDEX waitlist_confirmation_deliveries_email_attempted_at
  ON waitlist_confirmation_deliveries (email, attempted_at DESC);

CREATE TABLE waitlist_delivery_backoffs (
  provider TEXT PRIMARY KEY CHECK (provider = 'email'),
  retry_after TEXT NOT NULL,
  failure_code TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
