CREATE TABLE "pending_computer_deletions" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
