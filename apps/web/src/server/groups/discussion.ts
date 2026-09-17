import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import type { ChatMessage } from "@/server/openrouter";
import { completeWithUtilityModel } from "@/server/utility-model";
import { runAgentTurn, saveMessage, type AgentRow, type Emit, type TurnResult } from "@/server/chat/agent-turn";
import { isStopped } from "@/server/chat/generations";
import { beginRequest, createDelegator } from "@/server/chat/tasks";

type GroupRow = typeof schema.conversations.$inferSelect;

/**
 * A group round, started by one user message:
 * - @mentions: the mentioned agents answer, in order, once each.
 * - "mentions" mode: the orchestrator (or first member) answers once.
 * - "discussion" mode: a moderator (free utility model) gives the floor to one agent at a time
 *   until the question is settled, or the group's turn / cost limit is reached.
 * Agents never pick who speaks and never loop on their own.
 */

const TRANSCRIPT_MESSAGES = 16;

function mentioned(text: string, members: AgentRow[]) {
  const lower = text.toLowerCase();
  return members
    .map((agent) => ({ agent, at: lower.indexOf(`@${agent.name.toLowerCase()}`) }))
    .filter((m) => m.at !== -1)
    .sort((a, b) => a.at - b.at)
    .map((m) => m.agent);
}

async function transcript(conversationId: string, since: Date | null, names: Map<string, string>) {
  const rows = await db
    .select({ authorType: schema.messages.authorType, agentId: schema.messages.agentId, content: schema.messages.content, createdAt: schema.messages.createdAt })
    .from(schema.messages)
    .where(and(eq(schema.messages.conversationId, conversationId), eq(schema.messages.kind, "text")))
    .orderBy(desc(schema.messages.createdAt))
    .limit(TRANSCRIPT_MESSAGES);
  return rows
    .filter((m) => !since || m.createdAt > since)
    .reverse()
    .map((m) => `${m.authorType === "user" ? "User" : (names.get(m.agentId ?? "") ?? "Botling")}: ${m.content.slice(0, 700)}`)
    .join("\n\n");
}

/**
 * Asks the moderator who speaks next. Returns an agent, or null when the discussion is done.
 * Falls back to letting each member speak once (in order) if the moderator model is unavailable.
 */
export async function pickNextSpeaker(opts: {
  group: Pick<GroupRow, "id" | "title" | "description" | "contextStartedAt">;
  members: AgentRow[];
  names: Map<string, string>;
  spoken: string[];
}): Promise<AgentRow | null> {
  const { members, spoken } = opts;
  const fallback = () => (spoken.length === 0 ? (members.find((a) => a.isOrchestrator) ?? members[0]) : (members.find((a) => !spoken.includes(a.id)) ?? null));

  const roster = members.map((a) => `- ${a.name}: ${a.role || "(no role)"}`).join("\n");
  const turns = spoken.map((id) => opts.names.get(id) ?? "?");
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You moderate a group chat between a user and their AI agents. Decide who should speak next, or whether the discussion is finished.",
        "Rules:",
        "- Pick the member whose expertise best moves the conversation forward right now.",
        "- If nobody has answered the user's latest message yet, you must pick someone.",
        "- Prefer members who haven't spoken yet this round when they have something relevant to add; never pick the member who just spoke unless someone asked them a direct question.",
        "- Answer DONE when the user's request is answered, the agents agree, they are repeating themselves, or the next step needs the user.",
        'Reply with JSON only: {"next": "<exact member name>"} or {"next": "DONE"}.',
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Group: ${opts.group.title ?? "(untitled)"}${opts.group.description ? ` — ${opts.group.description}` : ""}`,
        `Members:\n${roster}`,
        `Turns so far since the user's latest message: ${turns.length ? turns.join(", ") : "none"}`,
        `Recent conversation:\n${await transcript(opts.group.id, opts.group.contextStartedAt, opts.names)}`,
      ].join("\n\n"),
    },
  ];

  const result = await completeWithUtilityModel(messages, {
    timeoutMs: 30_000,
    accept: (text) => /"next"\s*:/.test(text),
  });
  if ("error" in result) return fallback();

  const raw = result.text.match(/"next"\s*:\s*"([^"]*)"/)?.[1]?.trim() ?? "";
  if (!raw || raw.toUpperCase() === "DONE") return spoken.length === 0 ? fallback() : null;
  const wanted = raw.toLowerCase();
  return members.find((a) => a.name.toLowerCase() === wanted) ?? members.find((a) => wanted.includes(a.name.toLowerCase())) ?? fallback();
}

export async function runGroupRound(opts: {
  userId: string;
  group: GroupRow;
  members: AgentRow[];
  names: Map<string, string>;
  text: string;
  emit: Emit;
  signal: AbortSignal;
}): Promise<(TurnResult & { agentId: string }) | null> {
  const { group, members, names, emit, signal } = opts;
  if (!members.length) return null;

  const conversation = {
    id: group.id,
    type: "group" as const,
    names,
    description: group.description,
    discussion: group.discussionMode === "discussion",
  };

  const turn = async (agent: AgentRow, lastWord = false) => {
    const requestId = crypto.randomUUID();
    const endRequest = agent.isOrchestrator ? beginRequest(requestId) : null;
    try {
      const result = await runAgentTurn({
        agent,
        conversation,
        emit,
        signal,
        mode: "chat",
        userText: opts.text,
        extraMessages: lastWord
          ? [{ role: "user", content: "[Moderator] Yours is the last reply of this round: wrap up the discussion with a clear conclusion or recommendation for the user." }]
          : undefined,
        onDelegate: agent.isOrchestrator ? createDelegator({ orchestrator: agent, conversationId: group.id, requestId, emit }) : undefined,
      });
      return { ...result, agentId: agent.id };
    } finally {
      await endRequest?.();
    }
  };

  const direct = mentioned(opts.text, members);
  if (direct.length || group.discussionMode === "mentions") {
    const speakers = direct.length ? direct : [members.find((a) => a.isOrchestrator) ?? members[0]];
    let last: (TurnResult & { agentId: string }) | null = null;
    for (const agent of speakers) {
      if (signal.aborted) break;
      last = await turn(agent);
      if (last.error) break;
    }
    return last;
  }

  const spoken: string[] = [];
  let spent = 0;
  let last: (TurnResult & { agentId: string }) | null = null;
  while (!signal.aborted) {
    if (spoken.length >= group.maxTurns || spent >= group.maxCostUsd) {
      const reason = spoken.length >= group.maxTurns ? "turns" : "cost";
      emit({
        type: "message",
        message: await saveMessage({
          conversationId: group.id,
          authorType: "agent",
          kind: "event",
          content: reason === "turns" ? `Discussion paused after ${spoken.length} replies.` : "Discussion paused at its cost limit.",
          metadata: { discussionStop: reason },
        }),
      });
      break;
    }
    const next = await pickNextSpeaker({ group, members, names, spoken });
    if (!next || signal.aborted) break;
    last = await turn(next, spoken.length === group.maxTurns - 1);
    spoken.push(next.id);
    spent += last.costUsd;
    if (last.error || isStopped(signal)) break;
  }
  return last;
}
