import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { handleUserMessage } from "@/server/chat/respond";
import { getMessages, getOwnedConversation } from "@/server/data";
import { rateLimit } from "@/server/auth/rate-limit";
import { getLocale } from "@/lib/i18n/server";
import type { ChatStreamEvent } from "@/lib/types";

export async function GET(_request: Request, ctx: RouteContext<"/api/conversations/[id]/messages">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success || !(await getOwnedConversation(user.id, id))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ messages: await getMessages(id) });
}

const bodySchema = z.object({ text: z.string().trim().min(1).max(20_000) });

export async function POST(request: Request, ctx: RouteContext<"/api/conversations/[id]/messages">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Not found" }, { status: 404 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid message" }, { status: 400 });

  if (!rateLimit(`chat:${user.id}`, 30, 60_000).ok) {
    return Response.json({ error: "Too many messages" }, { status: 429 });
  }
  if (!(await getOwnedConversation(user.id, id))) return Response.json({ error: "Not found" }, { status: 404 });

  const locale = await getLocale();
  const encoder = new TextEncoder();
  // Generation is not tied to the HTTP request: if the client disconnects, the reply is still saved.
  const generation = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (event: ChatStreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      try {
        await handleUserMessage({ userId: user.id, conversationId: id, text: parsed.data.text, emit, signal: generation.signal, locale });
      } catch (error) {
        console.error("[chat]", error);
      } finally {
        emit({ type: "done" });
        if (open) controller.close();
      }
    },
    cancel() {
      // Client went away; keep generating so the reply is persisted.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
