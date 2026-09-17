CREATE TABLE "approval_rules" (
	"agent_id" uuid NOT NULL,
	"category" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_rules_agent_id_category_pk" PRIMARY KEY("agent_id","category")
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"card_message_id" uuid,
	"tool" text NOT NULL,
	"category" text NOT NULL,
	"detail" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"always_allowed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "autonomy" text DEFAULT 'ask_sensitive' NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_owner_status_idx" ON "approvals" USING btree ("owner_id","status");