import { and, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { getAgentDto, toMessageDto } from "@/server/data";
import type { ProposalStatus } from "@/server/db/schema";
import type { ToolDefinition } from "@/server/openrouter";
import type { Agent, Message } from "@/lib/types";

type AgentRow = typeof schema.agents.$inferSelect;
type ProposalRow = typeof schema.instructionProposals.$inferSelect;

export const MAX_INSTRUCTIONS_LENGTH = 8_000;

export const PROPOSE_INSTRUCTIONS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "propose_instructions_update",
    description:
      "Propose a change to your own saved instructions so you remember a lasting preference of the user. Nothing is saved until the user accepts it in the chat.",
    parameters: {
      type: "object",
      properties: {
        new_instructions: {
          type: "string",
          description:
            "The COMPLETE new saved instructions: the current text between the INSTRUCTIONS markers with your change applied. Plain text, short. Never copy any other part of your system prompt (role, crew, tools, language or safety rules).",
        },
        reason: { type: "string", description: "One short sentence explaining the preference you noticed." },
      },
      required: ["new_instructions", "reason"],
    },
  },
};

export const PROPOSAL_GUIDE =
  "Memory: when the user reveals a lasting preference about how you should work (tone, format, recurring facts about them or their projects), you may call propose_instructions_update once with your saved instructions plus that preference. Do it only for durable preferences — never for one-off requests or things already in your instructions — and don't exaggerate or add rules they didn't express. The user decides whether to accept.";

function cardMetadata(p: ProposalRow) {
  return {
    proposalId: p.id,
    proposalStatus: p.status,
    proposalBefore: p.before,
    proposalAfter: p.after,
    proposalReason: p.reason,
  };
}

/** Records a proposal and returns the card message plus the tool result for the model. */
export async function createProposal(agent: AgentRow, conversationId: string, args: Record<string, unknown>) {
  // Some models over-escape quotes inside tool arguments.
  const after = String(args.new_instructions ?? "").replace(/\\"/g, '"').trim();
  const reason = String(args.reason ?? "").trim().slice(0, 300);
  if (!after) return { toolResult: "Refused: new_instructions is empty." };
  if (after.length > MAX_INSTRUCTIONS_LENGTH) {
    return { toolResult: `Refused: instructions must be at most ${MAX_INSTRUCTIONS_LENGTH} characters.` };
  }
  if (after === agent.prompt.trim()) return { toolResult: "Refused: that is identical to your current instructions." };

  // A newer proposal supersedes any pending one for the same agent.
  const superseded = await db
    .update(schema.instructionProposals)
    .set({ status: "stale", decidedAt: new Date() })
    .where(and(eq(schema.instructionProposals.agentId, agent.id), eq(schema.instructionProposals.status, "pending")))
    .returning();
  const staleCards: Message[] = [];
  for (const p of superseded) {
    const card = await updateCard(p);
    if (card) staleCards.push(card);
  }

  const [proposal] = await db
    .insert(schema.instructionProposals)
    .values({ ownerId: agent.ownerId, agentId: agent.id, conversationId, before: agent.prompt, after, reason })
    .returning();
  const [card] = await db
    .insert(schema.messages)
    .values({
      conversationId,
      authorType: "agent",
      agentId: agent.id,
      kind: "proposal",
      content: reason || "Instructions update",
      metadata: cardMetadata(proposal),
    })
    .returning();
  await db
    .update(schema.instructionProposals)
    .set({ cardMessageId: card.id })
    .where(eq(schema.instructionProposals.id, proposal.id));

  return {
    card: toMessageDto(card),
    staleCards,
    toolResult:
      "Proposal shown to the user. It is NOT applied unless they accept it. Mention it in one short sentence and continue.",
  };
}

async function updateCard(p: ProposalRow) {
  if (!p.cardMessageId) return null;
  const [card] = await db
    .update(schema.messages)
    .set({ metadata: cardMetadata(p) })
    .where(eq(schema.messages.id, p.cardMessageId))
    .returning();
  return card ? toMessageDto(card) : null;
}

export type DecisionResult =
  | { ok: true; message: Message | null; agent?: Agent }
  | { ok: false; error: "not_found" | "already_decided" | "instructions_changed"; message?: Message | null };

/** The user's decision. Accepting applies the change only if the instructions are unchanged. */
export async function decideProposal(ownerId: string, proposalId: string, decision: "accept" | "reject"): Promise<DecisionResult> {
  const [proposal] = await db
    .select()
    .from(schema.instructionProposals)
    .where(and(eq(schema.instructionProposals.id, proposalId), eq(schema.instructionProposals.ownerId, ownerId)));
  if (!proposal) return { ok: false, error: "not_found" };
  if (proposal.status !== "pending") return { ok: false, error: "already_decided" };

  const decide = async (status: ProposalStatus) => {
    const [updated] = await db
      .update(schema.instructionProposals)
      .set({ status, decidedAt: new Date() })
      .where(and(eq(schema.instructionProposals.id, proposal.id), eq(schema.instructionProposals.status, "pending")))
      .returning();
    return updated ? updateCard(updated) : null;
  };

  if (decision === "reject") return { ok: true, message: await decide("rejected") };

  // Compare-and-set in a single UPDATE: only apply over the exact text the agent saw.
  const [agent] = await db
    .update(schema.agents)
    .set({ prompt: proposal.after })
    .where(
      and(
        eq(schema.agents.id, proposal.agentId),
        eq(schema.agents.ownerId, ownerId),
        eq(schema.agents.prompt, proposal.before),
      ),
    )
    .returning();
  if (!agent) return { ok: false, error: "instructions_changed", message: await decide("stale") };
  return { ok: true, message: await decide("accepted"), agent: await getAgentDto(agent) };
}
