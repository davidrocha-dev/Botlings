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
  autonomy: Autonomy;
  /** Live state; derived on the client from in-flight requests for now. */
  status: AgentStatus;
  spendTodayUsd: number;
  tokensToday: number;
};

export type MessageAuthor = { type: "user" } | { type: "agent"; agentId: string };

export type TaskStatus = "running" | "completed" | "failed" | "cancelled";
export type ProposalStatus = "pending" | "accepted" | "rejected" | "stale";
export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";
export type Autonomy = "ask_always" | "ask_sensitive" | "autonomous";

export type Message = {
  id: string;
  conversationId: string;
  author: MessageAuthor;
  text: string;
  createdAt: number;
  kind: "text" | "event" | "error" | "tool" | "task" | "proposal" | "approval" | "memory";
  model?: string | null;
  costUsd?: number | null;
  metadata?: {
    fromModel?: string;
    toModel?: string;
    errorCode?: number;
    tool?: string;
    taskId?: string;
    targetAgentId?: string;
    taskStatus?: TaskStatus;
    taskResult?: string;
    taskError?: string;
    proposalId?: string;
    proposalStatus?: ProposalStatus;
    proposalBefore?: string;
    proposalAfter?: string;
    proposalReason?: string;
    approvalId?: string;
    approvalStatus?: ApprovalStatus;
    approvalCategory?: string;
    approvalTool?: string;
    approvalDetail?: string;
    approvalAlwaysAllowed?: boolean;
  } | null;
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
  | { type: "computer"; agentId: string }
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

export type ComputerState = {
  status: "unavailable" | "no_image" | "stopped" | "starting" | "running";
  /** Path of the noVNC page on the screen gateway (same host as the app, `gatewayPort`). */
  vncPath?: string;
  gatewayPort?: number;
};
