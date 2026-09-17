import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { streamChat, type ChatMessage } from "@/server/openrouter";
import { env } from "@/server/env";
import { completeWithUtilityModel } from "@/server/utility-model";
import { runAgentTurn, saveMessage, type AgentRow, type Emit, type TurnResult } from "@/server/chat/agent-turn";
import { beginRequest, createDelegator } from "@/server/chat/tasks";

type GroupRow = typeof schema.conversations.$inferSelect;

/**
 * A group round, started by one user message:
 * - @mentions: the mentioned agents answer, in order, once each.
 * - "mentions" mode: the orchestrator (or first member) answers once.
 * - "discussion" mode: a moderator (free utility model) picks, up front, the short panel of members
 *   the message actually needs; they reply in that order and the last one wraps up.
 * Picking the panel once — instead of asking "who's next?" after every reply — keeps rounds short:
 * weak free models happily keep nominating speakers forever, but they are good at naming who matters.
 * Agents never pick who speaks and never loop on their own.
 */

const TRANSCRIPT_MESSAGES = 16;

/** What the chair does after the panel has spoken. */
const CLOSING_INSTRUCTION =
  "[Chair] You ran this round. Close it for the user, short and concrete: 1) tally the votes each member ended with (e.g. \"2 negotiate, 1 decline\"); 2) your recommendation in one or two sentences; 3) where they disagreed and why, if they did; 4) what is still missing for the user to decide, or the single next step. Don't repeat their reasoning, don't add new analysis, and don't decide for the user.";
/** Even when the group allows more, a moderator-picked panel stays this small. */
const MAX_PANEL = 3;

/** One non-streaming completion with a named model (the moderator's paid backup). */
async function complete(model: string, messages: ChatMessage[]) {
  let text = "";
  try {
    for await (const event of streamChat({ model, messages, signal: AbortSignal.timeout(20_000) })) {
      if (event.type === "delta") text += event.text;
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "moderator_failed" } as const;
  }
  return text.trim() ? ({ text: text.trim(), model } as const) : ({ error: "empty" } as const);
}

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
    .select({
      authorType: schema.messages.authorType,
      agentId: schema.messages.agentId,
      content: schema.messages.content,
      createdAt: schema.messages.createdAt,
    })
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
 * Asks the moderator which members should reply to the user's latest message, in order.
 * Falls back to a single reply (orchestrator, else first member) when the model is unavailable.
 */
export async function pickPanel(opts: {
  group: Pick<GroupRow, "id" | "title" | "description" | "contextStartedAt" | "maxTurns">;
  members: AgentRow[];
  names: Map<string, string>;
  /** The chair's model (the orchestrator's), used before the free models. */
  chairModel?: string;
}): Promise<AgentRow[]> {
  const { members } = opts;
  const limit = Math.max(1, Math.min(opts.group.maxTurns, MAX_PANEL));
  const fallback = [members[0]];
  if (members.length === 1) return fallback;

  const roster = members.map((a) => `- ${a.name}: ${a.role || "(no role)"}`).join("\n");
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You moderate a group chat between a user and their AI agents. Choose which members should reply to the user's latest message.",
        "Rules:",
        `- Pick the smallest useful panel: usually one member, at most ${limit}. Fewer is better.`,
        "- Only include a member whose own expertise is needed to answer; leave out anyone who would just agree, repeat or comment on someone else's area.",
        "- Order them so each one builds on the previous.",
        "- The user decides in the end: the panel advises, it does not need to cover every angle.",
        `Reply with JSON only: {"panel": ["Name"]} — between 1 and ${limit} exact member names.`,
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Group: ${opts.group.title ?? "(untitled)"}${opts.group.description ? ` — ${opts.group.description}` : ""}`,
        `Members:\n${roster}`,
        `Recent conversation:\n${await transcript(opts.group.id, opts.group.contextStartedAt, opts.names)}`,
      ].join("\n\n"),
    },
  ];

  // The chair's own model decides (fast, a fraction of a cent); free models are the fallback.
  let result = opts.chairModel ? await complete(opts.chairModel, messages) : { error: "no_chair" as const };
  if ("error" in result) result = await completeWithUtilityModel(messages, { timeoutMs: 15_000, accept: (text) => /"panel"\s*:/.test(text) });
  if ("error" in result && env.BOTLINGS_MODERATOR_MODEL) {
    result = await complete(env.BOTLINGS_MODERATOR_MODEL, messages);
  }
  if ("error" in result) {
    console.warn(`[moderator] unavailable (${result.error}); one reply only`);
    return fallback;
  }

  const raw = result.text.match(/"panel"\s*:\s*\[([^\]]*)\]/)?.[1] ?? "";
  const wanted = [...raw.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim().toLowerCase());
  const panel: AgentRow[] = [];
  for (const name of wanted) {
    const member = members.find((a) => a.name.toLowerCase() === name) ?? members.find((a) => name.includes(a.name.toLowerCase()));
    if (member && !panel.includes(member)) panel.push(member);
    if (panel.length >= limit) break;
  }
  console.info(`[moderator] ${result.model} → ${panel.map((a) => a.name).join(", ") || "(none)"}`);
  return panel.length ? panel : fallback;
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

  const turn = async (agent: AgentRow, lastWord = false, instruction?: string) => {
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
        extraMessages: instruction
          ? [{ role: "user", content: instruction }]
          : lastWord
            ? [
                {
                  role: "user",
                  content:
                    "[Moderator] You have the last word this round: close with a clear conclusion or recommendation for the user, without repeating the others' reasoning.",
                },
              ]
            : undefined,
        onDelegate: agent.isOrchestrator ? createDelegator({ orchestrator: agent, conversationId: group.id, requestId, emit }) : undefined,
      });
      return { ...result, agentId: agent.id };
    } finally {
      await endRequest?.();
    }
  };

  // The orchestrator chairs: it picks the panel and closes the round instead of taking a seat in it.
  const chair = members.find((a) => a.isOrchestrator) ?? null;
  const speakers = members.filter((a) => a !== chair);
  const direct = mentioned(opts.text, members);

  const panel = direct.length
    ? direct
    : group.discussionMode === "mentions"
      ? [chair ?? speakers[0]]
      : speakers.length
        ? (await pickPanel({ group, members: speakers, names, chairModel: chair?.model })).slice(0, group.maxTurns)
        : chair
          ? [chair]
          : [];

  const overBudget = async () => {
    emit({
      type: "message",
      message: await saveMessage({
        conversationId: group.id,
        authorType: "agent",
        kind: "event",
        content: "Discussion paused at its cost limit.",
        metadata: { discussionStop: "cost" },
      }),
    });
  };

  let spent = 0;
  let last: (TurnResult & { agentId: string }) | null = null;
  let stopped = false;
  for (const [index, agent] of panel.entries()) {
    if (signal.aborted) break;
    if (spent >= group.maxCostUsd) {
      stopped = true;
      await overBudget();
      break;
    }
    // Without a chair to close the round, the last panellist wraps up.
    last = await turn(agent, !chair && index === panel.length - 1 && panel.length > 1);
    spent += last.costUsd;
    if (last.error) break;
  }

  // The chair's closing message: tally of the votes, recommendation and what's still missing.
  const chairSpeaks = chair && !stopped && !signal.aborted && !last?.error && panel.length > 0 && !panel.includes(chair);
  if (chairSpeaks) {
    last = await turn(chair, false, CLOSING_INSTRUCTION);
  }
  return last;
}
