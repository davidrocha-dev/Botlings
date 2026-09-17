ALTER TABLE "conversations" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "discussion_mode" text DEFAULT 'discussion' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "max_turns" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "max_cost_usd" numeric(10, 4) DEFAULT 0.05 NOT NULL;