/**
 * Botlings screen gateway.
 *
 * Agent computers publish noVNC on 127.0.0.1 only. This small server makes the live screen
 * reachable from other devices (phone, Tailscale) without exposing it: every HTTP request and
 * WebSocket upgrade must carry a valid Botlings session cookie for the agent's owner.
 *
 *   GET /vnc/<agentId>/vnc.html?path=vnc/<agentId>/websockify  → noVNC page
 *   WS  /vnc/<agentId>/websockify                              → VNC stream
 */
import { createHash } from "node:crypto";
import http from "node:http";
import net from "node:net";
import Docker from "dockerode";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";

const SESSION_COOKIE = "botlings_session";
const VNC_PORT = "6080/tcp";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const docker = new Docker();

function parseCookies(header = "") {
  const out = new Map<string, string>();
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out.set(part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim()));
  }
  return out;
}

/** Resolves the target noVNC port if the request is authorised, otherwise null. */
async function authorise(req: http.IncomingMessage): Promise<{ port: number; rest: string } | null> {
  const url = new URL(req.url ?? "/", "http://gateway");
  const match = url.pathname.match(/^\/vnc\/([^/]+)(\/.*)?$/);
  if (!match || !UUID.test(match[1])) return null;
  const agentId = match[1];

  const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
  if (!token) return null;
  const sessionId = createHash("sha256").update(token).digest("hex");

  const [row] = await db
    .select({ agentId: schema.agents.id })
    .from(schema.sessions)
    .innerJoin(schema.agents, eq(schema.agents.ownerId, schema.sessions.userId))
    .where(
      and(eq(schema.sessions.id, sessionId), gt(schema.sessions.expiresAt, new Date()), eq(schema.agents.id, agentId)),
    )
    .limit(1);
  if (!row) return null;

  const info = await docker
    .getContainer(`botlings-agent-${agentId}`)
    .inspect()
    .catch(() => null);
  const hostPort = info?.State.Running ? info.NetworkSettings.Ports?.[VNC_PORT]?.[0]?.HostPort : undefined;
  if (!hostPort) return null;

  return { port: Number(hostPort), rest: `${match[2] ?? "/"}${url.search}` };
}

const server = http.createServer(async (req, res) => {
  try {
    const target = await authorise(req);
    if (!target) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: target.port,
        path: target.rest,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${target.port}`, cookie: "" },
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502).end("Screen unavailable");
      else res.destroy();
    });
    req.pipe(upstream);
  } catch (error) {
    console.error("[gateway]", error);
    if (!res.headersSent) res.writeHead(500).end();
  }
});

server.on("upgrade", async (req, socket, head) => {
  socket.on("error", () => socket.destroy());
  try {
    const target = await authorise(req);
    if (!target) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    const upstream = net.connect(target.port, "127.0.0.1", () => {
      const headers = Object.entries({ ...req.headers, host: `127.0.0.1:${target.port}`, cookie: undefined })
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
        .join("\r\n");
      upstream.write(`${req.method} ${target.rest} HTTP/1.1\r\n${headers}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("close", () => upstream.destroy());
  } catch (error) {
    console.error("[gateway] upgrade", error);
    socket.destroy();
  }
});

server.listen(env.BOTLINGS_GATEWAY_PORT, "0.0.0.0", () => {
  console.log(`[gateway] screen gateway on :${env.BOTLINGS_GATEWAY_PORT}`);
});
