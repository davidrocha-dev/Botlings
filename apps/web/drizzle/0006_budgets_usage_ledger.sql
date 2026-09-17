CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"agent_id" uuid,
	"period" text NOT NULL,
	"limit_usd" numeric(12, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"agent_id" uuid,
	"agent_name" text DEFAULT '' NOT NULL,
	"model" text,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(14, 8) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_scope_idx" ON "budgets" USING btree ("owner_id","agent_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_global_idx" ON "budgets" USING btree ("owner_id","period") WHERE "budgets"."agent_id" is null;--> statement-breakpoint
CREATE INDEX "usage_ledger_owner_created_idx" ON "usage_ledger" USING btree ("owner_id","created_at");--> statement-breakpoint
INSERT INTO "usage_ledger" ("owner_id", "agent_id", "agent_name", "model", "prompt_tokens", "completion_tokens", "cost_usd", "created_at")
SELECT c."owner_id", m."agent_id", coalesce(a."name", ''), m."model", coalesce(m."prompt_tokens", 0), coalesce(m."completion_tokens", 0), coalesce(m."cost_usd", 0), m."created_at"
FROM "messages" m
JOIN "conversations" c ON c."id" = m."conversation_id"
LEFT JOIN "agents" a ON a."id" = m."agent_id"
WHERE m."author_type" = 'agent' AND (coalesce(m."cost_usd", 0) > 0 OR coalesce(m."prompt_tokens", 0) + coalesce(m."completion_tokens", 0) > 0);
