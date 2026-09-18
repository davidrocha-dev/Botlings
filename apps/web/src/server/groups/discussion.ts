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
 *   the message actually needs and what each one covers; the chair opens the round with that split,
 *   they reply in that order, and the chair closes.
 * Picking the panel once — instead of asking "who's next?" after every reply — keeps rounds short:
 * weak free models happily keep nominating speakers forever, but they are good at naming who matters.
 * Agents never pick who speaks and never loop on their own.
 */

const TRANSCRIPT_MESSAGES = 16;

/** What the chair does after the panel has spoken. */
const CLOSING_INSTRUCTION =
  "[Chair] You ran this round. Close it for the user, short and concrete: 1) tally the votes the panel ended with (e.g. \"2 negotiate, 1 decline\") — you chaired and don't vote, so never count yourself, and count a member who asked for more information as exactly that, not as a refusal; 2) your recommendation in one or two sentences; 3) where they disagreed and why, if they did; 4) what is still missing for the user to decide, or the single next step. Don't repeat their reasoning, don't add new analysis, and don't decide for the user.";
/** Even when the group allows more, a panel the moderator improvises stays this small. */
const MAX_PANEL = 3;
/** A flow the owner wrote is a deliberate order of steps, so it may run a little longer. */
const MAX_FLOW_PANEL = 5;

/** A reasoning model thinks before it answers, so the moderator's call gets room to finish. */
const MODERATOR_TIMEOUT_MS = 45_000;

/** One non-streaming completion with a named model (the moderator's paid backup). */
async function complete(model: string, messages: ChatMessage[]) {
  let text = "";
  try {
    for await (const event of streamChat({ model, messages, signal: AbortSignal.timeout(MODERATOR_TIMEOUT_MS) })) {
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

/** A panellist and the single part of the question they were given. */
export type Seat = { agent: AgentRow; covers: string };

/**
 * Asks the moderator which members should reply to the user's latest message, in order,
 * and what each one covers, so two of them don't research the same thing.
 * Falls back to a single reply (orchestrator, else first member) when the model is unavailable.
 */
export async function pickPanel(opts: {
  group: Pick<GroupRow, "id" | "title" | "description" | "flows" | "contextStartedAt" | "maxTurns">;
  members: AgentRow[];
  names: Map<string, string>;
  /** The message this round answers, matched against the group's flows. */
  text: string;
  /** The chair's model (the orchestrator's), used before the free models. */
  chairModel?: string;
}): Promise<Seat[]> {
  const { members } = opts;
  // `?? ""`: after a schema change, a dev server's cached Drizzle client still selects the old columns,
  // and a round must never die over a missing optional one.
  const flows = (opts.group.flows ?? "").trim();
  // A flow the owner wrote may run longer than a panel the moderator improvises.
  const limit = Math.max(1, Math.min(opts.group.maxTurns, flows ? MAX_FLOW_PANEL : MAX_PANEL));
  const improvised = Math.min(limit, MAX_PANEL);
  // When the moderator can't run, a matching flow still decides; only then does one member answer alone.
  const written = flows ? flowSeats(flows, members, opts.text, limit) : [];
  const fallback: Seat[] = written.length ? written : [{ agent: members[0], covers: "" }];
  if (members.length === 1) return [{ agent: members[0], covers: "" }];

  const roster = members.map((a) => `- ${a.name}: ${a.role || "(no role)"}`).join("\n");
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You moderate a group chat between a user and their AI agents. Choose which members should reply to the user's latest message.",
        "Rules:",
        flows
          ? `- The user wrote the flows below for recurring situations. If one of them fits this message, follow it: its steps are the panel, in that order, up to ${limit}. Skip a step only when the message makes it pointless, and keep a step whose work the request actually needs — including whoever would have to carry the decision out, not only those who analyse it.`
          : "",
        flows
          ? `- If no flow fits, pick the smallest useful panel yourself: usually one member, at most ${improvised}. Fewer is better.`
          : `- Pick the smallest useful panel: usually one member, at most ${improvised}. Fewer is better.`,
        "- Only include a member whose own expertise is needed to answer; leave out anyone who would just agree, repeat or comment on someone else's area.",
        "- Order them so each one builds on the previous: what the others need in order to answer comes first (is it even possible, is the date free), the verdict last.",
        "- Give each one a different part of the question, in a few words (\"covers\"). The parts must not overlap: if two of them would look up the same thing (the same prices, the same venue, the same dates), give it to one of them only and say so in the other one's part.",
        "- The user decides in the end: the panel advises, it does not need to cover every angle.",
        `Reply with JSON only: {"panel": [{"name": "Name", "covers": "what only this member does"}]} — between 1 and ${limit} exact member names.`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
    {
      role: "user",
      content: [
        `Group: ${opts.group.title ?? "(untitled)"}${opts.group.description ? ` — ${opts.group.description}` : ""}`,
        `Members:\n${roster}`,
        flows && `Flows the user wrote:\n${flows}`,
        `Recent conversation:\n${await transcript(opts.group.id, opts.group.contextStartedAt, opts.names)}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
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

  const panel: Seat[] = [];
  for (const { name, covers } of parseSeats(result.text)) {
    const key = name.toLowerCase();
    const member = members.find((a) => a.name.toLowerCase() === key) ?? members.find((a) => key.includes(a.name.toLowerCase()));
    if (member && !panel.some((seat) => seat.agent === member)) panel.push({ agent: member, covers });
    if (panel.length >= limit) break;
  }
  console.info(`[moderator] ${result.model} → ${panel.map((s) => `${s.agent.name}${s.covers ? ` (${s.covers})` : ""}`).join(", ") || "(none)"}`);
  return panel.length ? panel : fallback;
}

/**
 * Reads a flow the owner wrote without asking a model: the members named in the line, in the order
 * they appear, each with the note in brackets after their name. Free models run out and paid ones time
 * out, and when that happens a written flow is still a better answer than one arbitrary member.
 * With several flows it only picks one when the message clearly points at it, since guessing the wrong
 * flow is worse than improvising.
 */
export function flowSeats(flows: string, members: AgentRow[], text: string, limit: number): Seat[] {
  const lines = flows
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const words = (value: string) => new Set(value.toLowerCase().match(/\p{L}{4,}/gu) ?? []);
  const asked = words(text);
  const scored = lines
    .map((line) => {
      const situation = line.split(/[:—–-]/)[0] ?? "";
      return { line, hits: [...words(situation)].filter((word) => asked.has(word)).length };
    })
    .sort((a, b) => b.hits - a.hits);
  const chosen = lines.length === 1 ? scored[0] : scored[0].hits > 0 && scored[0].hits > (scored[1]?.hits ?? 0) ? scored[0] : null;
  if (!chosen) return [];

  const seats: Seat[] = [];
  for (const member of [...members]
    .map((agent) => ({ agent, at: chosen.line.toLowerCase().indexOf(agent.name.toLowerCase()) }))
    .filter((m) => m.at !== -1)
    .sort((a, b) => a.at - b.at)) {
    const after = chosen.line.slice(member.at + member.agent.name.length);
    seats.push({ agent: member.agent, covers: after.match(/^\s*\(([^)]*)\)/)?.[1]?.trim() ?? "" });
    if (seats.length >= limit) break;
  }
  return seats;
}

/** Reads the moderator's answer, tolerating both the object form and a bare list of names. */
function parseSeats(text: string): { name: string; covers: string }[] {
  const list = text.match(/"panel"\s*:\s*\[([\s\S]*?)\]/)?.[1];
  if (!list) return [];
  const objects = [...list.matchAll(/\{[^{}]*\}/g)].map((m) => m[0]);
  if (objects.length) {
    return objects
      .map((obj) => ({
        name: (obj.match(/"name"\s*:\s*"([^"]*)"/)?.[1] ?? "").trim(),
        covers: (obj.match(/"covers"\s*:\s*"([^"]*)"/)?.[1] ?? "").trim(),
      }))
      .filter((seat) => seat.name);
  }
  return [...list.matchAll(/"([^"]+)"/g)].map((m) => ({ name: m[1].trim(), covers: "" })).filter((seat) => seat.name);
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

  const turn = async (agent: AgentRow, { instruction, lastWord }: { instruction?: string; lastWord?: boolean } = {}) => {
    const notes = [
      instruction,
      lastWord &&
        "[Moderator] You have the last word this round: close with a clear conclusion or recommendation for the user, without repeating the others' reasoning.",
    ].filter((note): note is string => Boolean(note));
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
        extraMessages: notes.length ? notes.map((content) => ({ role: "user" as const, content })) : undefined,
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

  const seat = (agent: AgentRow): Seat => ({ agent, covers: "" });
  const panel: Seat[] = direct.length
    ? direct.map(seat)
    : group.discussionMode === "mentions"
      ? [seat(chair ?? speakers[0])]
      : speakers.length
        ? (await pickPanel({ group, members: speakers, names, text: opts.text, chairModel: chair?.model })).slice(0, group.maxTurns)
        : chair
          ? [seat(chair)]
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

  // The chair speaks first, so the user hears the plan before the panel starts working on it. The plan is
  // written from the panel, not asked from a model: given a turn of its own the chair answers the question
  // itself, taking the parts it just handed out. This costs nothing and cannot drift.
  const chairs = chair && panel.length > 0 && !panel.some((s) => s.agent === chair) ? chair : null;
  if (chairs && panel.length > 1 && panel.some((s) => s.covers)) {
    emit({
      type: "message",
      message: await saveMessage({
        conversationId: group.id,
        authorType: "agent",
        agentId: chairs.id,
        kind: "text",
        content: panel.map((s) => `**${s.agent.name}** — ${s.covers || s.agent.role || ""}`.trim()).join("\n"),
        metadata: { roundPlan: true },
      }),
    });
  }

  for (const [index, { agent, covers }] of panel.entries()) {
    if (signal.aborted) break;
    if (spent >= group.maxCostUsd) {
      stopped = true;
      await overBudget();
      break;
    }
    last = await turn(agent, {
      // Each panellist is told what is theirs, so two of them don't research the same thing.
      instruction: covers
        ? `[Chair] Your part of this round: ${covers}. The others cover the rest — don't look up, price, judge or re-check anything outside your part, even to confirm it, and don't tell them what to do; if you need something from their part, name them in one short line and leave it there.`
        : undefined,
      // Without a chair to close the round, the last panellist wraps up.
      lastWord: !chair && index === panel.length - 1 && panel.length > 1,
    });
    spent += last.costUsd;
    if (last.error) break;
  }

  // The chair's closing message: tally of the votes, recommendation and what's still missing.
  if (chairs && !stopped && !signal.aborted && !last?.error) {
    last = await turn(chairs, { instruction: CLOSING_INSTRUCTION });
  }
  return last;
}
