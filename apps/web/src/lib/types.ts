import type { AgentStatus, BotlingAppearance } from "@/components/avatar/botling-options";

/** Client-facing DTOs shared by the API and the UI. */

export type Agent = {
  id: string;
  name: string;
  role: string;
  prompt: string;
  model: string;
  appearance: BotlingAppearance;
  isOrchestrator: boolean;
  /** Live state; derived on the client from in-flight requests for now. */
  status: AgentStatus;
  spendTodayUsd: number;
  tokensToday: number;
};

export type MessageAuthor = { type: "user" } | { type: "agent"; agentId: string };

export type Message = {
  id: string;
  conversationId: string;
  author: MessageAuthor;
  text: string;
  createdAt: number;
  kind: "text" | "event" | "error";
  model?: string | null;
  costUsd?: number | null;
  metadata?: { fromModel?: string; toModel?: string; errorCode?: number } | null;
  /** True while the reply is still streaming. */
  streaming?: boolean;
};

export type Conversation = {
  id: string;
  type: "direct" | "group";
  title: string | null;
  memberIds: string[];
  unread: number;
  pinned: boolean;
  lastMessage: Message | null;
};

export type Bootstrap = {
  user: { id: string; name: string; email: string };
  agents: Agent[];
  conversations: Conversation[];
  defaultModel: string;
};

/** Newline-delimited JSON events streamed by POST /api/conversations/:id/messages. */
export type ChatStreamEvent =
  | { type: "user_message"; message: Message }
  | { type: "typing"; agentId: string }
  | { type: "delta"; messageId: string; agentId: string; text: string }
  | { type: "message"; message: Message }
  | { type: "agent"; agent: Agent }
  | { type: "done" };

export type ModelOption = {
  id: string;
  name: string;
  contextLength: number;
  promptPrice: number;
  completionPrice: number;
  free: boolean;
  tools: boolean;
  vision: boolean;
};
