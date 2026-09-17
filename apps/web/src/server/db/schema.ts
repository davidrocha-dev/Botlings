import { relations } from "drizzle-orm";
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
  ...timestamps,
});

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
};

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
    kind: text("kind", { enum: ["text", "event", "error", "tool", "task", "proposal"] }).notNull().default("text"),
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
