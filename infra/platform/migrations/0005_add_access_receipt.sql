ALTER TABLE waitlist_subscribers ADD COLUMN access_receipt_hash TEXT;
ALTER TABLE waitlist_subscribers ADD COLUMN access_receipt_expires_at TEXT;

CREATE INDEX waitlist_subscribers_access_receipt
  ON waitlist_subscribers (access_receipt_hash);
