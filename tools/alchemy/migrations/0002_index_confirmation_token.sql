CREATE UNIQUE INDEX waitlist_subscribers_confirmation_token_hash
  ON waitlist_subscribers (confirmation_token_hash)
  WHERE confirmation_token_hash IS NOT NULL;
