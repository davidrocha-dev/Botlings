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

export type MessageMetadata = {
  fromModel?: string;
  toModel?: string;
  errorCode?: number;
  tool?: string;
};

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    authorType: text("author_type", { enum: ["user", "agent"] }).notNull(),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["text", "event", "error", "tool"] }).notNull().default("text"),
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
