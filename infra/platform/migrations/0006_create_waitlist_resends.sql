CREATE TABLE waitlist_resend_deliveries (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE
    REFERENCES waitlist_subscribers(email) ON DELETE CASCADE,
  state TEXT NOT NULL
    CHECK (state IN ('attempting', 'accepted', 'rejected', 'retryable', 'unknown')),
  attempted_at TEXT NOT NULL,
  state_changed_at TEXT NOT NULL,
  provider_message_id TEXT,
  failure_code TEXT
);

CREATE INDEX waitlist_resend_deliveries_email_attempted_at
  ON waitlist_resend_deliveries (email, attempted_at DESC);
