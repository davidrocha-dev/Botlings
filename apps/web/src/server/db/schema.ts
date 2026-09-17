import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { BotlingAppearance } from "@/components/avatar/botling-options";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["owner", "admin", "member"] }).notNull().default("member"),
  /** Which events notify the user outside the app (Web Push, Telegram). */
  notificationPrefs: jsonb("notification_prefs")
    .$type<NotificationPrefs>()
    .notNull()
    .default({ approvals: true, routines: true, replies: true }),
  ...timestamps,
});

export type NotificationPrefs = { approvals: boolean; routines: boolean; replies: boolean };

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the session token; the raw token only lives in the cookie. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const licenses = pgTable("licenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(),
  plan: text("plan").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
  ...timestamps,
});

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: text("role").notNull().default(""),
    prompt: text("prompt").notNull().default(""),
    model: text("model").notNull(),
    appearance: jsonb("appearance").$type<BotlingAppearance>().notNull(),
    isOrchestrator: boolean("is_orchestrator").notNull().default(false),
    /** ask_always: every action on the computer needs approval; ask_sensitive: only risky ones. */
    autonomy: text("autonomy", { enum: ["ask_always", "ask_sensitive", "autonomous"] }).notNull().default("ask_sensitive"),
    ...timestamps,
  },
  (t) => [index("agents_owner_idx").on(t.ownerId)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["direct", "group"] }).notNull(),
    title: text("title"),
    pinned: boolean("pinned").notNull().default(false),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
    /** Rolling summary of messages that fell out of the model's history window. */
    summary: text("summary").notNull().default(""),
    /** Messages created at or before this instant are covered by `summary`. */
    summaryUntil: timestamp("summary_until", { withTimezone: true }),
    /** Set by /new: older messages are kept but no longer sent to the model. */
    contextStartedAt: timestamp("context_started_at", { withTimezone: true }),
    /** Groups: what the group is for (shown to its agents and the moderator). */
    description: text("description").notNull().default(""),
    /** Groups: "discussion" lets the moderator pass the word between agents; "mentions" gets one reply. */
    discussionMode: text("discussion_mode", { enum: ["discussion", "mentions"] }).notNull().default("discussion"),
    /** Groups: most agent replies per user message. */
    maxTurns: integer("max_turns").notNull().default(6),
    /** Groups: most spend per user message, in USD. */
    maxCostUsd: numeric("max_cost_usd", { precision: 10, scale: 4, mode: "number" }).notNull().default(0.05),
    ...timestamps,
  },
  (t) => [index("conversations_owner_idx").on(t.ownerId)],
);

export const conversationMembers = pgTable(
  "conversation_members",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.agentId] })],
);

export type TaskStatus = "running" | "completed" | "failed" | "cancelled";

export type MessageMetadata = {
  fromModel?: string;
  toModel?: string;
  errorCode?: number;
  tool?: string;
  /** Task cards (kind "task"): a snapshot kept in sync with the tasks table. */
  taskId?: string;
  targetAgentId?: string;
  taskStatus?: TaskStatus;
  taskResult?: string;
  taskError?: string;
  /** Instruction-change proposals (kind "proposal"). */
  proposalId?: string;
  proposalStatus?: ProposalStatus;
  proposalBefore?: string;
  proposalAfter?: string;
  proposalReason?: string;
  /** Approval requests (kind "approval"). */
  approvalId?: string;
  approvalStatus?: ApprovalStatus;
  approvalCategory?: string;
  approvalTool?: string;
  approvalDetail?: string;
  approvalAlwaysAllowed?: boolean;
  /** Routine cards (kind "routine"): a run, or an agent's routine suggestion. */
  routineId?: string;
  routineName?: string;
  routineRunId?: string;
  routineRunStatus?: "running" | "completed" | "failed";
  routineSuggestion?: "pending" | "enabled" | "discarded";
  routineCron?: string;
  /** Group events (kind "event"): members joining/leaving, a discussion pausing at its limit. */
  memberEvent?: "joined" | "left";
  memberAgentId?: string;
  discussionStop?: "turns" | "cost";
  /** Slash command replies (kind "command"). */
  command?: string;
  pendingApprovals?: { id: string; agentName: string; detail: string }[];
};

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export type ProposalStatus = "pending" | "accepted" | "rejected" | "stale";

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    authorType: text("author_type", { enum: ["user", "agent"] }).notNull(),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["text", "event", "error", "tool", "task", "proposal", "approval", "memory", "routine", "command"] })
      .notNull()
      .default("text"),
    content: text("content").notNull(),
    model: text("model"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    costUsd: numeric("cost_usd", { precision: 14, scale: 8, mode: "number" }),
    metadata: jsonb("metadata").$type<MessageMetadata>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("messages_conversation_created_idx").on(t.conversationId, t.createdAt),
    index("messages_agent_created_idx").on(t.agentId, t.createdAt),
  ],
);

/**
 * Work delegated by the orchestrator to another agent. `requestId` groups the delegations made
 * while answering one user message, so the orchestrator summarises once they are all finished.
 */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    orchestratorAgentId: uuid("orchestrator_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    orchestratorConversationId: uuid("orchestrator_conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    targetAgentId: uuid("target_agent_id").references(() => agents.id, { onDelete: "set null" }),
    targetConversationId: uuid("target_conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    cardMessageId: uuid("card_message_id"),
    instruction: text("instruction").notNull(),
    status: text("status", { enum: ["running", "completed", "failed", "cancelled"] }).notNull().default("running"),
    result: text("result"),
    error: text("error"),
    costUsd: numeric("cost_usd", { precision: 14, scale: 8, mode: "number" }).notNull().default(0),
    summarized: boolean("summarized").notNull().default(false),
    ...timestamps,
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("tasks_request_idx").on(t.requestId), index("tasks_owner_status_idx").on(t.ownerId, t.status)],
);

/**
 * An agent's proposed change to its own instructions. Never applied by the agent: only when the
 * owner accepts, and only if the instructions are still exactly `before`.
 */
export const instructionProposals = pgTable(
  "instruction_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    cardMessageId: uuid("card_message_id"),
    before: text("before").notNull(),
    after: text("after").notNull(),
    reason: text("reason").notNull().default(""),
    status: text("status", { enum: ["pending", "accepted", "rejected", "stale"] }).notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("instruction_proposals_agent_status_idx").on(t.agentId, t.status)],
);

/** An action an agent wants to take that is waiting for (or received) the user's decision. */
export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    cardMessageId: uuid("card_message_id"),
    tool: text("tool").notNull(),
    category: text("category").notNull(),
    /** Human-readable description of the action (already free of secret values). */
    detail: text("detail").notNull(),
    status: text("status", { enum: ["pending", "approved", "denied", "expired"] }).notNull().default("pending"),
    alwaysAllowed: boolean("always_allowed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("approvals_owner_status_idx").on(t.ownerId, t.status)],
);

/** "Always allow" decisions: this agent may perform this category of action without asking. */
export const approvalRules = pgTable(
  "approval_rules",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.category] })],
);

/** How a routine's schedule was defined, so the UI can show and edit it in plain words. */
export type RoutineSchedule =
  | { type: "daily"; time: string }
  | { type: "weekdays"; time: string }
  | { type: "weekly"; day: number; time: string }
  | { type: "hourly"; every: number }
  | { type: "cron"; cron: string };

/** A scheduled job: at each occurrence the agent works on `instruction` in its own chat. */
export const routines = pgTable(
  "routines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    instruction: text("instruction").notNull(),
    schedule: jsonb("schedule").$type<RoutineSchedule>().notNull(),
    cron: text("cron").notNull(),
    timeZone: text("time_zone").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: text("created_by", { enum: ["user", "agent"] }).notNull().default("user"),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("routines_due_idx").on(t.enabled, t.nextRunAt), index("routines_owner_idx").on(t.ownerId)],
);

export const routineRuns = pgTable(
  "routine_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    routineId: uuid("routine_id")
      .notNull()
      .references(() => routines.id, { onDelete: "cascade" }),
    trigger: text("trigger", { enum: ["schedule", "manual"] }).notNull(),
    status: text("status", { enum: ["running", "completed", "failed"] }).notNull().default("running"),
    result: text("result"),
    error: text("error"),
    costUsd: numeric("cost_usd", { precision: 14, scale: 8, mode: "number" }).notNull().default(0),
    cardMessageId: uuid("card_message_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("routine_runs_routine_idx").on(t.routineId, t.startedAt)],
);

/** Browser push subscriptions (one per device/browser). */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    /** UI language when subscribed, so notification text matches it. */
    locale: text("locale").notNull().default("en"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_idx").on(t.endpoint), index("push_subscriptions_user_idx").on(t.userId)],
);

/** A Telegram private chat linked to a Botlings user (one per user). */
export const telegramLinks = pgTable("telegram_links", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  chatId: text("chat_id").notNull().unique(),
  username: text("username"),
  locale: text("locale").notNull().default("en"),
  /** Agent that receives plain messages; null means the orchestrator. */
  activeAgentId: uuid("active_agent_id").references(() => agents.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Durable facts an agent keeps across conversations; visible and editable by the owner. */
export const agentMemories = pgTable(
  "agent_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    source: text("source", { enum: ["agent", "user"] }).notNull(),
    ...timestamps,
  },
  (t) => [index("agent_memories_agent_idx").on(t.agentId)],
);

/**
 * Append-only record of model spend per agent turn. Kept separately from messages so deleting an
 * agent (and its chat) never erases cost history or resets budgets.
 */
export const usageLedger = pgTable(
  "usage_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    /** Snapshot, so reports can still name deleted agents. */
    agentName: text("agent_name").notNull().default(""),
    model: text("model"),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 14, scale: 8, mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usage_ledger_owner_created_idx").on(t.ownerId, t.createdAt)],
);

/**
 * Spending limits in USD. `agentId` null = limit for all of the owner's agents together.
 * When a limit is reached, agents stop calling models until the next day/month or a higher limit.
 */
export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
    period: text("period", { enum: ["day", "month"] }).notNull(),
    limitUsd: numeric("limit_usd", { precision: 12, scale: 4, mode: "number" }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("budgets_scope_idx").on(t.ownerId, t.agentId, t.period),
    // agent_id is NULL for global budgets, which a plain unique index treats as distinct.
    uniqueIndex("budgets_global_idx").on(t.ownerId, t.period).where(sql`${t.agentId} is null`),
  ],
);

/** Encrypted values agents can use (as environment variables) without ever seeing them. */
export const secrets = pgTable(
  "secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Environment variable name, e.g. GITHUB_TOKEN. */
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** base64(iv | authTag | ciphertext), AES-256-GCM. */
    ciphertext: text("ciphertext").notNull(),
    ...timestamps,
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("secrets_owner_name_idx").on(t.ownerId, t.name)],
);

/** Which agents may use which secret. */
export const secretAccess = pgTable(
  "secret_access",
  {
    secretId: uuid("secret_id")
      .notNull()
      .references(() => secrets.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.secretId, t.agentId] })],
);

/** Agent computers whose deletion must still happen (the agent row is already gone). */
export const pendingComputerDeletions = pgTable("pending_computer_deletions", {
  agentId: uuid("agent_id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversationsRelations = relations(conversations, ({ many }) => ({
  members: many(conversationMembers),
}));

export const conversationMembersRelations = relations(conversationMembers, ({ one }) => ({
  conversation: one(conversations, { fields: [conversationMembers.conversationId], references: [conversations.id] }),
  agent: one(agents, { fields: [conversationMembers.agentId], references: [agents.id] }),
}));
