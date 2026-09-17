import { getCurrentUser } from "@/server/auth/session";
import { subscribe } from "@/server/events";

/** Server-Sent Events: live updates for background work (delegated tasks, follow-up replies). */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      send(": connected\n\n");
      const unsubscribe = subscribe(user.id, (event) => send(`data: ${JSON.stringify(event)}\n\n`));
      // Keeps proxies and the browser from closing an idle connection.
      const heartbeat = setInterval(() => send(": ping\n\n"), 25_000);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
