/**
 * End-to-end smoke test: runs commands, a routine and a group round against a throwaway database,
 * with real model calls (a few cents). Usage, from the repo root:
 *
 *   pnpm smoke                      # default model
 *   BOTLINGS_SMOKE_MODEL=... pnpm smoke
 *
 * It never touches your real database: DATABASE_URL is cleared and a temporary PGlite folder is used.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATABASE_URL = "";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "botlings-smoke-"));
process.env.BOTLINGS_DATA_DIR = dataDir;

const MODEL = process.env.BOTLINGS_SMOKE_MODEL || "qwen/qwen3.7-flash";

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const { runMigrations } = await import("../src/server/db/migrate");
  const { db, schema } = await import("../src/server/db");
  const { createAgent, seedWorkspace } = await import("../src/server/data");
  const { handleUserMessage } = await import("../src/server/chat/respond");
  const { createGroup, groupInputSchema } = await import("../src/server/groups/groups");
  const { runRoutine } = await import("../src/server/routines/routines");
  const { asc, eq } = await import("drizzle-orm");

  await runMigrations();
  check("migrations", true);

  const [user] = await db.insert(schema.users).values({ email: "smoke@test.local", name: "Smoke", passwordHash: "x", role: "owner" }).returning();
  await seedWorkspace(user.id);
  await db.update(schema.agents).set({ model: MODEL }).where(eq(schema.agents.ownerId, user.id));
  const [atlas] = await db.select().from(schema.agents).where(eq(schema.agents.ownerId, user.id));

  const make = (name: string, role: string, prompt: string) =>
    createAgent(user.id, { name, role, prompt, model: MODEL, appearance: { shape: "round", color: "mint", mood: "happy" } });
  const { agent: finance, conversation: financeChat } = await make("Fin", "Costs and margins analyst", "Be brief: 2 sentences.");
  const { agent: legal } = await make("Lex", "Contract reviewer", "Be brief: 2 sentences.");

  /** Runs one user message and returns the messages it produced. */
  const send = async (conversationId: string, text: string) => {
    const out: { kind: string; agentId: string | null; text: string }[] = [];
    await handleUserMessage({
      userId: user.id,
      conversationId,
      text,
      locale: "pt",
      signal: new AbortController().signal,
      emit: (event) => {
        if (event.type !== "message") return;
        out.push({
          kind: event.message.kind,
          agentId: event.message.author.type === "agent" ? event.message.author.agentId : null,
          text: event.message.text,
        });
      },
    });
    return out;
  };

  // 1. Commands
  const help = await send(financeChat.id, "/ajuda");
  check("command /ajuda", help.some((m) => m.kind === "command" && m.text.includes("/novo")), help[0]?.kind ?? "no reply");
  const cost = await send(financeChat.id, "/custo");
  check("command /custo", cost.some((m) => m.kind === "command" && m.text.includes("$")));
  const stop = await send(financeChat.id, "/parar");
  check("command /parar", stop.some((m) => m.kind === "command"));

  // 2. A reply that must know today's date
  const year = new Date().getFullYear();
  const dated = await send(financeChat.id, "Em que ano estamos? Responde só com o número.");
  check("knows the current year", dated.some((m) => m.kind === "text" && m.text.includes(String(year))), dated.find((m) => m.kind === "text")?.text.slice(0, 40) ?? "");

  // 3. New topic drops the history
  await send(financeChat.id, "O código secreto é BANANA42. Responde só 'ok'.");
  await send(financeChat.id, "/novo");
  const forgotten = await send(financeChat.id, "Qual era o código secreto? Se não souberes responde 'não sei'.");
  check("/novo clears the context", !forgotten.some((m) => m.kind === "text" && m.text.includes("BANANA42")));

  // 4. Routine
  const [routine] = await db
    .insert(schema.routines)
    .values({
      ownerId: user.id,
      agentId: finance.id,
      name: "Ping",
      instruction: "Responde apenas 'pong'.",
      schedule: { type: "daily", time: "09:00" },
      cron: "0 9 * * *",
      timeZone: "Europe/Lisbon",
      nextRunAt: new Date(Date.now() + 3600e3),
    })
    .returning();
  const started = await runRoutine(routine.id, "manual");
  const [run] = await db.select().from(schema.routineRuns).where(eq(schema.routineRuns.routineId, routine.id));
  check("routine runs", started && run?.status === "completed", run?.status ?? "no run");

  // 5. Group: Atlas chairs, the panel votes, Atlas closes
  const group = await createGroup(
    user.id,
    groupInputSchema.parse({
      title: "Decisões",
      description: "Decidir se vale a pena aceitar propostas de trabalho.",
      memberIds: [finance.id, legal.id],
      maxTurns: 6,
    }),
  );
  check("orchestrator joins every group", group.memberIds.includes(atlas.id), `${group.memberIds.length} members`);

  const round = await send(
    group.id,
    "Proposta: 1.200€ por um trabalho de um dia, mas pagam só 60 dias depois e sem contrato escrito. Aceitamos?",
  );
  const replies = round.filter((m) => m.kind === "text" && m.agentId);
  const speakers = [...new Set(replies.map((m) => m.agentId))];
  check("group round is short", replies.length <= 4, `${replies.length} replies from ${speakers.length} agents`);
  check("panel members vote", replies.slice(0, -1).some((m) => /^\s*vot[oe]\s*:/im.test(m.text)), replies[0]?.text.slice(-60) ?? "");
  check("the chair closes the round", replies.at(-1)?.agentId === atlas.id, replies.at(-1)?.text.slice(0, 60) ?? "no replies");

  const saved = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, group.id)).orderBy(asc(schema.messages.createdAt));
  check("everything is saved", saved.length >= replies.length + 1, `${saved.length} messages`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(1);
});
