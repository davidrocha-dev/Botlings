import { and, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { toMessageDto } from "@/server/data";
import { publish } from "@/server/events";
import type { ApprovalStatus } from "@/server/db/schema";
import type { ChatStreamEvent, Message } from "@/lib/types";
import { notify } from "@/server/notifications/notify";

const APPROVAL_TIMEOUT_MS = 15 * 60_000;

type ApprovalRow = typeof schema.approvals.$inferSelect;
type Waiter = (status: Exclude<ApprovalStatus, "pending">) => void;

const globalApprovals = globalThis as unknown as { botlingsApprovalWaiters?: Map<string, Waiter> };
/** Agent turns blocked on a decision, resolved by the decision API. */
const waiters = (globalApprovals.botlingsApprovalWaiters ??= new Map());

function cardMetadata(a: ApprovalRow) {
  return {
    approvalId: a.id,
    approvalStatus: a.status,
    approvalCategory: a.category,
    approvalTool: a.tool,
    approvalDetail: a.detail,
    approvalAlwaysAllowed: a.alwaysAllowed,
  };
}

async function syncCard(a: ApprovalRow): Promise<Message | null> {
  if (!a.cardMessageId) return null;
  const [card] = await db
    .update(schema.messages)
    .set({ metadata: cardMetadata(a) })
    .where(eq(schema.messages.id, a.cardMessageId))
    .returning();
  if (!card) return null;
  const message = toMessageDto(card);
  publish(a.ownerId, a.conversationId, { type: "message", message });
  return message;
}

export async function isAlwaysAllowed(agentId: string, category: string) {
  const [rule] = await db
    .select()
    .from(schema.approvalRules)
    .where(and(eq(schema.approvalRules.agentId, agentId), eq(schema.approvalRules.category, category)));
  return !!rule;
}

/**
 * Posts an approval card and waits for the user's decision (or times out).
 * The agent's turn is paused meanwhile; nothing is executed unless this returns "approved".
 */
export async function requestApproval(opts: {
  ownerId: string;
  agentId: string;
  conversationId: string;
  tool: string;
  category: string;
  detail: string;
  emit: (event: ChatStreamEvent) => void;
  signal: AbortSignal;
}): Promise<Exclude<ApprovalStatus, "pending">> {
  const [approval] = await db
    .insert(schema.approvals)
    .values({
      ownerId: opts.ownerId,
      agentId: opts.agentId,
      conversationId: opts.conversationId,
      tool: opts.tool,
      category: opts.category,
      detail: opts.detail,
    })
    .returning();

  const [card] = await db
    .insert(schema.messages)
    .values({
      conversationId: opts.conversationId,
      authorType: "agent",
      agentId: opts.agentId,
      kind: "approval",
      content: opts.detail,
      metadata: cardMetadata(approval),
    })
    .returning();
  await db.update(schema.approvals).set({ cardMessageId: card.id }).where(eq(schema.approvals.id, approval.id));
  opts.emit({ type: "message", message: toMessageDto(card) });
  void db
    .select({ name: schema.agents.name })
    .from(schema.agents)
    .where(eq(schema.agents.id, opts.agentId))
    .then(([agent]) =>
      notify(opts.ownerId, {
        type: "approval",
        agentName: agent?.name ?? "Botling",
        detail: opts.detail,
        conversationId: opts.conversationId,
        approvalId: approval.id,
      }),
    );

  const decision = await new Promise<Exclude<ApprovalStatus, "pending">>((resolve) => {
    const finish: Waiter = (status) => {
      clearTimeout(timer);
      opts.signal.removeEventListener("abort", onAbort);
      waiters.delete(approval.id);
      resolve(status);
    };
    const onAbort = () => finish("expired");
    const timer = setTimeout(() => finish("expired"), APPROVAL_TIMEOUT_MS);
    opts.signal.addEventListener("abort", onAbort, { once: true });
    waiters.set(approval.id, finish);
  });

  if (decision === "expired") {
    const [expired] = await db
      .update(schema.approvals)
      .set({ status: "expired", decidedAt: new Date() })
      .where(and(eq(schema.approvals.id, approval.id), eq(schema.approvals.status, "pending")))
      .returning();
    if (expired) await syncCard(expired);
  }
  return decision;
}

export type ApprovalDecision = "approve" | "deny" | "always";

/** Records the user's decision and resumes the waiting agent turn. */
export async function decideApproval(ownerId: string, approvalId: string, decision: ApprovalDecision) {
  const status: ApprovalStatus = decision === "deny" ? "denied" : "approved";
  const [approval] = await db
    .update(schema.approvals)
    .set({ status, alwaysAllowed: decision === "always", decidedAt: new Date() })
    .where(
      and(eq(schema.approvals.id, approvalId), eq(schema.approvals.ownerId, ownerId), eq(schema.approvals.status, "pending")),
    )
    .returning();

  if (!approval) {
    const [existing] = await db
      .select({ id: schema.approvals.id })
      .from(schema.approvals)
      .where(and(eq(schema.approvals.id, approvalId), eq(schema.approvals.ownerId, ownerId)));
    return { ok: false as const, error: existing ? ("already_decided" as const) : ("not_found" as const) };
  }

  if (decision === "always") {
    await db.insert(schema.approvalRules).values({ agentId: approval.agentId, category: approval.category }).onConflictDoNothing();
  }

  const message = await syncCard(approval);
  const waiter = waiters.get(approval.id);
  if (waiter) {
    waiter(status as Exclude<ApprovalStatus, "pending">);
  } else {
    // Nobody is waiting (server restarted): the action was never taken.
    const [expired] = await db
      .update(schema.approvals)
      .set({ status: "expired" })
      .where(eq(schema.approvals.id, approval.id))
      .returning();
    return { ok: false as const, error: "expired" as const, message: expired ? await syncCard(expired) : message };
  }
  return { ok: true as const, message };
}

/** Pending approvals from a previous process can never resume: mark them expired on startup. */
export async function expireStaleApprovals() {
  const stale = await db.select().from(schema.approvals).where(eq(schema.approvals.status, "pending"));
  for (const a of stale) {
    if (waiters.has(a.id)) continue;
    const [expired] = await db
      .update(schema.approvals)
      .set({ status: "expired", decidedAt: new Date() })
      .where(eq(schema.approvals.id, a.id))
      .returning();
    if (expired) await syncCard(expired);
  }
}
