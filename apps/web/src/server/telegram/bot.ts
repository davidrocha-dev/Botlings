import { randomBytes } from "node:crypto";
import { and, asc, eq, or } from "drizzle-orm";
import { decideApproval, type ApprovalDecision } from "@/server/approvals/approvals";
import { rateLimit } from "@/server/auth/rate-limit";
import { commandHelpText, parseCommand, type PendingApproval } from "@/server/chat/commands";
import { handleUserMessage } from "@/server/chat/respond";
import { db, schema } from "@/server/db";
import { publish } from "@/server/events";
import { notificationText, registerNotificationChannel, type NotificationChannel } from "@/server/notifications/notify";
import { sendText, telegramToken, tg, TelegramError, type TelegramCallbackQuery, type TelegramMessage, type TelegramUpdate, type TelegramUser } from "./api";

/**
 * One Telegram bot for the whole install, via long polling (no public URL needed). A private chat
 * is linked to a Botlings user with a one-time code; plain messages go to the orchestrator or to
 * the agent picked with /agent <name>.
 */

const LINK_CODE_TTL_MS = 10 * 60_000;
/** Replies in a conversation used from Telegram go back to Telegram for this long. */
const BOUND_TTL_MS = 30 * 60_000;

type BotState = {
  running: boolean;
  username: string | null;
  codes: Map<string, { userId: string; locale: string; expiresAt: number }>;
  bound: Map<string, number>;
  queues: Map<string, Promise<void>>;
};
const globalBot = globalThis as unknown as { botlingsTelegram?: BotState };
const state = (globalBot.botlingsTelegram ??= {
  running: false,
  username: null,
  codes: new Map(),
  bound: new Map(),
  queues: new Map(),
});

type Lang = "en" | "pt";

const TEXT = {
  en: {
    notLinked: "This chat isn't linked to Botlings yet. In Botlings open Settings → Notifications → Telegram and tap “Connect Telegram”.",
    badCode: "That link has expired or was already used. Create a new one in Botlings → Notifications.",
    linked: (name: string) => `Connected to Botlings as ${name}. 👋`,
    help: (agent: string) =>
      `You're talking to ${agent}.\n\n/agents — list your agents\n/agent <name> — talk to another agent\n/agent — back to the orchestrator\n/unlink — disconnect this chat\n${commandHelpText("en")}`,
    agents: "Your agents:",
    current: "current",
    switched: (name: string) => `Now talking to ${name}.`,
    noAgent: (name: string) => `No agent called “${name}”. Send /agents to see the list.`,
    unlinked: "Disconnected. You won't get messages from Botlings here anymore.",
    slowDown: "Too many messages — wait a minute and try again.",
    noChat: "That agent has no chat to talk in.",
    allowOnce: "Allow once",
    alwaysAllow: "Always allow",
    deny: "Deny",
    decided: { approve: "✅ Allowed", always: "✅ Always allowed", deny: "⛔ Denied" },
    expired: "This request is no longer waiting.",
  },
  pt: {
    notLinked: "Este chat ainda não está ligado ao Botlings. No Botlings abre Definições → Notificações → Telegram e toca em “Ligar Telegram”.",
    badCode: "Esse link expirou ou já foi usado. Cria um novo no Botlings → Notificações.",
    linked: (name: string) => `Ligado ao Botlings como ${name}. 👋`,
    help: (agent: string) =>
      `Estás a falar com ${agent}.\n\n/agentes — lista os teus agentes\n/agente <nome> — falar com outro agente\n/agente — voltar ao orquestrador\n/desligar — desligar este chat\n${commandHelpText("pt")}`,
    agents: "Os teus agentes:",
    current: "atual",
    switched: (name: string) => `Agora estás a falar com ${name}.`,
    noAgent: (name: string) => `Não há nenhum agente chamado “${name}”. Envia /agentes para ver a lista.`,
    unlinked: "Desligado. Já não vais receber mensagens do Botlings aqui.",
    slowDown: "Demasiadas mensagens — espera um minuto e tenta outra vez.",
    noChat: "Esse agente não tem conversa onde falar.",
    allowOnce: "Permitir uma vez",
    alwaysAllow: "Permitir sempre",
    deny: "Recusar",
    decided: { approve: "✅ Permitido", always: "✅ Sempre permitido", deny: "⛔ Recusado" },
    expired: "Este pedido já não está à espera.",
  },
};

const langOf = (locale: string | null | undefined): Lang => (locale === "pt" ? "pt" : "en");
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

// ── Linking ────────────────────────────────────────────────────────────────

export function telegramConfigured() {
  return Boolean(telegramToken());
}

/** One-time deep link that links the Telegram chat that opens it to this user. */
export function createLinkCode(userId: string, locale: string) {
  const now = Date.now();
  for (const [code, entry] of state.codes) if (entry.expiresAt < now) state.codes.delete(code);
  const code = randomBytes(12).toString("base64url");
  state.codes.set(code, { userId, locale: langOf(locale), expiresAt: now + LINK_CODE_TTL_MS });
  return { url: state.username ? `https://t.me/${state.username}?start=${code}` : null, code, expiresAt: now + LINK_CODE_TTL_MS };
}

export async function telegramStatus(userId: string) {
  const [link] = await db.select().from(schema.telegramLinks).where(eq(schema.telegramLinks.userId, userId));
  return {
    configured: telegramConfigured(),
    running: state.running && Boolean(state.username),
    botUsername: state.username,
    linked: link ? { username: link.username } : null,
  };
}

export async function unlinkTelegram(userId: string) {
  const [link] = await db.delete(schema.telegramLinks).where(eq(schema.telegramLinks.userId, userId)).returning();
  if (link) await sendText(link.chatId, TEXT[langOf(link.locale)].unlinked).catch(() => {});
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function linkByChat(chatId: string) {
  const [link] = await db.select().from(schema.telegramLinks).where(eq(schema.telegramLinks.chatId, chatId));
  return link ?? null;
}

async function ownerAgents(userId: string) {
  return db
    .select({ id: schema.agents.id, name: schema.agents.name, role: schema.agents.role, isOrchestrator: schema.agents.isOrchestrator })
    .from(schema.agents)
    .where(eq(schema.agents.ownerId, userId))
    .orderBy(asc(schema.agents.createdAt));
}

async function activeAgent(link: typeof schema.telegramLinks.$inferSelect) {
  const agents = await ownerAgents(link.userId);
  return agents.find((a) => a.id === link.activeAgentId) ?? agents.find((a) => a.isOrchestrator) ?? agents[0] ?? null;
}

async function directConversationId(agentId: string) {
  const [row] = await db
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .innerJoin(schema.conversationMembers, eq(schema.conversationMembers.conversationId, schema.conversations.id))
    .where(and(eq(schema.conversations.type, "direct"), eq(schema.conversationMembers.agentId, agentId)))
    .limit(1);
  return row?.id ?? null;
}

function isBound(conversationId: string) {
  const at = state.bound.get(conversationId);
  if (!at) return false;
  if (Date.now() - at > BOUND_TTL_MS) {
    state.bound.delete(conversationId);
    return false;
  }
  return true;
}

/** Runs work for one chat in order, without blocking the polling loop. */
function enqueue(chatId: string, job: () => Promise<void>) {
  const previous = state.queues.get(chatId) ?? Promise.resolve();
  const next = previous.then(job).catch((error: unknown) => console.error("[telegram]", error instanceof Error ? error.message : error));
  state.queues.set(chatId, next);
  void next.finally(() => {
    if (state.queues.get(chatId) === next) state.queues.delete(chatId);
  });
}

// ── Incoming ───────────────────────────────────────────────────────────────

async function handleStart(chatId: string, from: TelegramUser | undefined, code: string | undefined, fallback: Lang) {
  const existing = await linkByChat(chatId);
  if (!code) {
    if (!existing) return void (await sendText(chatId, TEXT[fallback].notLinked));
    const agent = await activeAgent(existing);
    return void (await sendText(chatId, TEXT[langOf(existing.locale)].help(agent?.name ?? "Botlings")));
  }

  const entry = state.codes.get(code);
  state.codes.delete(code);
  if (!entry || entry.expiresAt < Date.now()) return void (await sendText(chatId, TEXT[existing ? langOf(existing.locale) : fallback].badCode));

  const [user] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, entry.userId));
  if (!user) return;
  // One chat per user and one user per chat: replace whatever was linked before.
  await db
    .delete(schema.telegramLinks)
    .where(or(eq(schema.telegramLinks.chatId, chatId), eq(schema.telegramLinks.userId, entry.userId)));
  const [link] = await db
    .insert(schema.telegramLinks)
    .values({ userId: entry.userId, chatId, username: from?.username ?? from?.first_name ?? null, locale: entry.locale })
    .returning();
  const t = TEXT[langOf(link.locale)];
  const agent = await activeAgent(link);
  await sendText(chatId, `${t.linked(user.name)}\n\n${t.help(agent?.name ?? "Botlings")}`);
}

async function handleMessage(message: TelegramMessage) {
  if (message.chat.type !== "private" || !message.text) return;
  const chatId = String(message.chat.id);
  const text = message.text.trim();
  const fallback: Lang = message.from?.language_code?.startsWith("pt") ? "pt" : "en";

  const [head, ...rest] = text.split(/\s+/);
  const command = text.startsWith("/") ? head.slice(1).split("@")[0].toLowerCase() : null;
  const argument = rest.join(" ").trim();

  if (command === "start") return handleStart(chatId, message.from, argument || undefined, fallback);

  const link = await linkByChat(chatId);
  if (!link) return void (await sendText(chatId, TEXT[fallback].notLinked));
  const t = TEXT[langOf(link.locale)];
  if (!rateLimit(`telegram:${chatId}`, 20, 60_000).ok) return void (await sendText(chatId, t.slowDown));

  switch (command) {
    case "agents":
    case "agentes": {
      const agents = await ownerAgents(link.userId);
      const current = await activeAgent(link);
      const lines = agents.map((a) => `• ${a.name}${a.role ? ` — ${a.role}` : ""}${a.id === current?.id ? ` (${t.current})` : ""}`);
      return void (await sendText(chatId, `${t.agents}\n\n${lines.join("\n")}`));
    }
    case "agent":
    case "agente": {
      const agents = await ownerAgents(link.userId);
      const wanted = normalize(argument.replace(/^@/, ""));
      const target = !wanted
        ? agents.find((a) => a.isOrchestrator)
        : (agents.find((a) => normalize(a.name) === wanted) ?? agents.find((a) => normalize(a.name).startsWith(wanted)));
      if (!target) return void (await sendText(chatId, t.noAgent(argument)));
      await db
        .update(schema.telegramLinks)
        .set({ activeAgentId: target.isOrchestrator ? null : target.id })
        .where(eq(schema.telegramLinks.userId, link.userId));
      return void (await sendText(chatId, t.switched(target.name)));
    }
    case "unlink":
    case "desligar":
      return unlinkTelegram(link.userId);
    case "help":
    case "ajuda":
      return void (await sendText(chatId, t.help((await activeAgent(link))?.name ?? "Botlings")));
  }

  const agent = await activeAgent(link);
  const conversationId = agent && (await directConversationId(agent.id));
  if (!conversationId) return void (await sendText(chatId, t.noChat));

  state.bound.set(conversationId, Date.now());
  const typing = () => tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  void typing();
  const timer = setInterval(typing, 4500);
  const notices: { text: string; markdown: boolean; approvals?: PendingApproval[] }[] = [];
  try {
    await handleUserMessage({
      userId: link.userId,
      conversationId,
      text,
      locale: link.locale,
      signal: new AbortController().signal,
      emit: (event) => {
        // The web app sees the conversation live too.
        publish(link.userId, conversationId, event);
        if (event.type !== "message") return;
        const { kind, text: body, metadata } = event.message;
        if (kind === "error" || kind === "event") notices.push({ text: body, markdown: false });
        if (kind === "command") notices.push({ text: body, markdown: true, approvals: metadata?.pendingApprovals });
      },
    });
  } finally {
    clearInterval(timer);
  }
  // Replies arrive through the notification channel below; errors and model changes are sent here.
  for (const notice of notices) {
    await sendText(chatId, notice.text, undefined, { markdown: notice.markdown });
    for (const approval of notice.approvals ?? []) await sendApproval(link, approval);
  }
}

async function handleCallback(query: TelegramCallbackQuery) {
  const answer = (text?: string) => tg("answerCallbackQuery", { callback_query_id: query.id, text }).catch(() => {});
  const match = query.data?.match(/^ap:([0-9a-f-]{36}):(approve|deny|always)$/);
  const chatId = query.message ? String(query.message.chat.id) : null;
  if (!match || !chatId || !query.message) return answer();

  const link = await linkByChat(chatId);
  if (!link) return answer(TEXT.en.notLinked);
  const t = TEXT[langOf(link.locale)];
  const decision = match[2] as ApprovalDecision;
  // decideApproval checks the approval belongs to this user.
  const result = await decideApproval(link.userId, match[1], decision);
  const status = result.ok ? t.decided[decision] : t.expired;
  await answer(status);
  await tg("editMessageText", {
    chat_id: chatId,
    message_id: query.message.message_id,
    text: `${query.message.text ?? ""}\n\n${status}`.slice(0, 4096),
    link_preview_options: { is_disabled: true },
  }).catch(() => {});
}

function dispatch(update: TelegramUpdate) {
  const message = update.message;
  if (message) {
    if (parseCommand(message.text ?? "")?.name === "stop") void handleMessage(message).catch((error) => console.error("[telegram]", error));
    else enqueue(String(message.chat.id), () => handleMessage(message));
  }
  else if (update.callback_query) void handleCallback(update.callback_query).catch((error) => console.error("[telegram] callback", error));
}

// ── Outgoing (notification channel) ────────────────────────────────────────

/** An approval request with Allow once / Always allow / Deny buttons. */
async function sendApproval(link: typeof schema.telegramLinks.$inferSelect, approval: PendingApproval) {
  const lang = langOf(link.locale);
  const t = TEXT[lang];
  const { title } = notificationText(
    { type: "approval", agentName: approval.agentName, detail: approval.detail, conversationId: "", approvalId: approval.id },
    lang,
  );
  await sendText(link.chatId, `🔐 ${title}\n\n${approval.detail}`, {
    inline_keyboard: [
      [
        { text: t.allowOnce, callback_data: `ap:${approval.id}:approve` },
        { text: t.alwaysAllow, callback_data: `ap:${approval.id}:always` },
      ],
      [{ text: t.deny, callback_data: `ap:${approval.id}:deny` }],
    ],
  });
}

const telegramChannel: NotificationChannel = async (userId, event, ctx) => {
  const [link] = await db.select().from(schema.telegramLinks).where(eq(schema.telegramLinks.userId, userId));
  if (!link || !state.running) return false;
  const lang = langOf(link.locale);
  const bound = isBound(event.conversationId);

  if (event.type === "reply") {
    if (!bound && (!ctx.enabled || ctx.present)) return false;
    const active = await activeAgent(link);
    // In the chat you're using from Telegram, replies read like a normal chat; elsewhere, say who wrote.
    const prefix = bound && active?.name === event.agentName ? "" : `${event.agentName}:\n`;
    await sendText(link.chatId, prefix + event.text, undefined, { markdown: true });
    return bound;
  }

  if (event.type === "approval") {
    if (!bound && (!ctx.enabled || ctx.present)) return false;
    await sendApproval(link, { id: event.approvalId, agentName: event.agentName, detail: event.detail });
    return bound;
  }

  if (!ctx.enabled || ctx.present) return false;
  const { title, body } = notificationText(event, lang);
  await sendText(link.chatId, `⏰ ${title}\n\n${body.slice(0, 3500)}`, undefined, { markdown: true });
  return false;
};

// ── Lifecycle ──────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const START_RETRIES = 5;
const START_RETRY_MS = 15_000;

async function poll() {
  let offset = 0;
  while (state.running) {
    try {
      const updates = await tg<TelegramUpdate[]>(
        "getUpdates",
        { offset, timeout: 25, allowed_updates: ["message", "callback_query"] },
        AbortSignal.timeout(35_000),
      );
      for (const update of updates) {
        offset = update.update_id + 1;
        dispatch(update);
      }
    } catch (error) {
      if (error instanceof TelegramError && error.code === 401) {
        console.error("[telegram] TELEGRAM_BOT_TOKEN was rejected; the bot is off.");
        state.running = false;
        state.username = null;
        return;
      }
      if (!(error instanceof DOMException && error.name === "TimeoutError")) {
        console.error("[telegram] polling:", error instanceof Error ? error.message : error);
        await sleep(5000);
      }
    }
  }
}

/** Starts the bot when TELEGRAM_BOT_TOKEN is set. Safe to call more than once. */
export async function startTelegramBot(attempt = 1) {
  registerNotificationChannel("telegram", telegramChannel);
  if (state.running || !telegramToken()) return;
  state.running = true;
  try {
    const me = await tg<TelegramUser>("getMe");
    state.username = me.username ?? null;
    // Long polling doesn't work while a webhook is set.
    await tg("deleteWebhook", { drop_pending_updates: false });
    await tg("setMyCommands", {
      commands: [
        { command: "agents", description: "List your agents" },
        { command: "agent", description: "Talk to an agent: /agent <name>" },
        { command: "new", description: "Start a new topic" },
        { command: "stop", description: "Stop what the agent is doing" },
        { command: "status", description: "Tasks, routines and approvals in progress" },
        { command: "approvals", description: "Actions waiting for you" },
        { command: "cost", description: "Spend today and this month" },
        { command: "model", description: "Show or change the model" },
        { command: "memory", description: "What the agent remembers" },
        { command: "routines", description: "Your routines" },
        { command: "routine", description: "Run a routine now: /routine <name>" },
        { command: "help", description: "How to use the bot" },
        { command: "unlink", description: "Disconnect this chat" },
      ],
    });
    await tg("setMyCommands", {
      language_code: "pt",
      commands: [
        { command: "agentes", description: "Lista os teus agentes" },
        { command: "agente", description: "Falar com um agente: /agente <nome>" },
        { command: "novo", description: "Começar um assunto novo" },
        { command: "parar", description: "Parar o que o agente está a fazer" },
        { command: "estado", description: "Tarefas, rotinas e aprovações em curso" },
        { command: "aprovacoes", description: "Ações à tua espera" },
        { command: "custo", description: "Gasto de hoje e do mês" },
        { command: "modelo", description: "Ver ou mudar o modelo" },
        { command: "memoria", description: "O que o agente sabe sobre ti" },
        { command: "rotinas", description: "As tuas rotinas" },
        { command: "rotina", description: "Correr uma rotina: /rotina <nome>" },
        { command: "ajuda", description: "Como usar o bot" },
        { command: "desligar", description: "Desligar este chat" },
      ],
    });
    console.log(`[telegram] bot @${state.username} is running`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.running = false;
    // A bad token is final; anything else (no network yet at boot) is worth retrying.
    if (error instanceof TelegramError && error.code === 401) {
      console.error("[telegram] TELEGRAM_BOT_TOKEN was rejected; the bot is off.");
      return;
    }
    if (attempt < START_RETRIES) {
      console.warn(`[telegram] could not start (${message}); retrying in ${START_RETRY_MS / 1000}s`);
      await sleep(START_RETRY_MS);
      return startTelegramBot(attempt + 1);
    }
    console.error("[telegram] could not start:", message);
    return;
  }
  void poll();
}
