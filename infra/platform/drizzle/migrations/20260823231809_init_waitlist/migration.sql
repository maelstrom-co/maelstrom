CREATE TABLE `waitlist_subscribers` (
	`email` TEXT COLLATE NOCASE PRIMARY KEY,
	`status` text DEFAULT 'pending' NOT NULL,
	`confirmation_token_hash` text,
	`confirmation_expires_at` text,
	`confirmed_at` text,
	`unsubscribed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`confirmation_sent_at` text,
	`access_receipt_hash` text,
	`access_receipt_expires_at` text,
	CONSTRAINT "waitlist_subscribers_status_check" CHECK("status" IN ('pending', 'confirmed', 'unsubscribed'))
);
--> statement-breakpoint
CREATE TABLE `waitlist_confirmation_deliveries` (
	`id` text PRIMARY KEY,
	`email` TEXT COLLATE NOCASE NOT NULL,
	`token_hash` text NOT NULL UNIQUE,
	`expires_at` text NOT NULL,
	`state` text NOT NULL,
	`attempted_at` text NOT NULL,
	`state_changed_at` text NOT NULL,
	`provider_message_id` text,
	`failure_code` text,
	CONSTRAINT `fk_waitlist_confirmation_deliveries_email_waitlist_subscribers_email_fk` FOREIGN KEY (`email`) REFERENCES `waitlist_subscribers`(`email`) ON DELETE CASCADE,
	CONSTRAINT "waitlist_confirmation_deliveries_state_check" CHECK("state" IN ('attempting', 'accepted', 'rejected', 'retryable', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE `waitlist_resend_deliveries` (
	`id` text PRIMARY KEY,
	`email` TEXT COLLATE NOCASE NOT NULL,
	`state` text NOT NULL,
	`attempted_at` text NOT NULL,
	`state_changed_at` text NOT NULL,
	`provider_message_id` text,
	`failure_code` text,
	CONSTRAINT `fk_waitlist_resend_deliveries_email_waitlist_subscribers_email_fk` FOREIGN KEY (`email`) REFERENCES `waitlist_subscribers`(`email`) ON DELETE CASCADE,
	CONSTRAINT "waitlist_resend_deliveries_state_check" CHECK("state" IN ('attempting', 'accepted', 'rejected', 'retryable', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE `waitlist_delivery_backoffs` (
	`provider` text PRIMARY KEY,
	`retry_after` text NOT NULL,
	`failure_code` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "waitlist_delivery_backoffs_provider_check" CHECK("provider" = 'email')
);
--> statement-breakpoint
CREATE INDEX `waitlist_confirmation_deliveries_email_attempted_at` ON `waitlist_confirmation_deliveries` (`email`,"attempted_at" DESC);--> statement-breakpoint
CREATE INDEX `waitlist_resend_deliveries_email_attempted_at` ON `waitlist_resend_deliveries` (`email`,"attempted_at" DESC);--> statement-breakpoint
CREATE INDEX `waitlist_subscribers_status_created_at` ON `waitlist_subscribers` (`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `waitlist_subscribers_confirmation_token_hash` ON `waitlist_subscribers` (`confirmation_token_hash`) WHERE "waitlist_subscribers"."confirmation_token_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `waitlist_subscribers_access_receipt` ON `waitlist_subscribers` (`access_receipt_hash`);
