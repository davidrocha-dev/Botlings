import { randomBytes } from "node:crypto";
import Docker from "dockerode";
import { env } from "@/server/env";
import type { ComputerState } from "@/lib/types";

/**
 * One Docker container per agent ("computer"). Containers are stopped (not removed) when idle,
 * so the home volume, browser profile and logins survive; starting again takes a few seconds.
 */

const LABEL = "botlings.agent";
const TOKEN_LABEL = "botlings.token";
const RUNNER_PORT = "8080/tcp";
const VNC_PORT = "6080/tcp";

const docker = new Docker();

type Runtime = { lastUsed: number; busy: number; starting?: Promise<RunningComputer> };
type RunningComputer = { runnerUrl: string; vncUrl: string; token: string };

const globalState = globalThis as unknown as {
  botlingsComputers?: Map<string, Runtime>;
  botlingsReaper?: NodeJS.Timeout;
};
const runtimes = (globalState.botlingsComputers ??= new Map());

function runtime(agentId: string) {
  let r = runtimes.get(agentId);
  if (!r) {
    r = { lastUsed: Date.now(), busy: 0 };
    runtimes.set(agentId, r);
  }
  return r;
}

const containerName = (agentId: string) => `botlings-agent-${agentId}`;
const volumeName = (agentId: string) => `botlings-home-${agentId}`;

let dockerCheck: { ok: boolean; at: number } | null = null;

export async function dockerAvailable() {
  if (dockerCheck && Date.now() - dockerCheck.at < 15_000) return dockerCheck.ok;
  const ok = await docker.ping().then(
    () => true,
    () => false,
  );
  dockerCheck = { ok, at: Date.now() };
  return ok;
}

async function imageExists() {
  return docker
    .getImage(env.BOTLINGS_AGENT_IMAGE)
    .inspect()
    .then(
      () => true,
      () => false,
    );
}

async function inspect(agentId: string) {
  return docker
    .getContainer(containerName(agentId))
    .inspect()
    .catch(() => null);
}

function endpoints(info: Docker.ContainerInspectInfo): RunningComputer | null {
  const ports = info.NetworkSettings.Ports ?? {};
  const runner = ports[RUNNER_PORT]?.[0]?.HostPort;
  const vnc = ports[VNC_PORT]?.[0]?.HostPort;
  const token = info.Config.Labels?.[TOKEN_LABEL];
  if (!info.State.Running || !runner || !vnc || !token) return null;
  return {
    runnerUrl: `http://127.0.0.1:${runner}`,
    vncUrl: `http://127.0.0.1:${vnc}/vnc.html?autoconnect=1&resize=scale&reconnect=1`,
    token,
  };
}

export async function getComputer(agentId: string): Promise<ComputerState> {
  if (!(await dockerAvailable())) return { status: "unavailable" };
  if (runtimes.get(agentId)?.starting) return { status: "starting" };
  const info = await inspect(agentId);
  const running = info && endpoints(info);
  if (running) return { status: "running", vncUrl: running.vncUrl };
  if (!(await imageExists())) return { status: "no_image" };
  return { status: "stopped" };
}

async function waitForRunner(computer: RunningComputer) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${computer.runnerUrl}/health`, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Computer did not become ready in time");
}

async function runningAgentIds() {
  const list = await docker.listContainers({ filters: { label: [LABEL], status: ["running"] } });
  return list.map((c) => c.Labels[LABEL]);
}

/** Frees a slot by stopping the least recently used idle computer, if the limit is reached. */
async function makeRoom(exceptAgentId: string) {
  const running = (await runningAgentIds()).filter((id) => id !== exceptAgentId);
  if (running.length < env.BOTLINGS_MAX_ACTIVE_COMPUTERS) return;
  const idle = running
    .filter((id) => (runtimes.get(id)?.busy ?? 0) === 0)
    .sort((a, b) => (runtimes.get(a)?.lastUsed ?? 0) - (runtimes.get(b)?.lastUsed ?? 0));
  if (!idle.length) throw new Error(`All ${env.BOTLINGS_MAX_ACTIVE_COMPUTERS} computers are busy. Try again in a moment.`);
  await stopComputer(idle[0]);
}

async function createContainer(agentId: string) {
  const token = randomBytes(24).toString("hex");
  return docker.createContainer({
    name: containerName(agentId),
    Image: env.BOTLINGS_AGENT_IMAGE,
    Hostname: "botling",
    Env: [`BOTLINGS_RUNNER_TOKEN=${token}`],
    Labels: { [LABEL]: agentId, [TOKEN_LABEL]: token },
    ExposedPorts: { [RUNNER_PORT]: {}, [VNC_PORT]: {} },
    HostConfig: {
      // Published on loopback only, on random free ports.
      PortBindings: {
        [RUNNER_PORT]: [{ HostIp: "127.0.0.1", HostPort: "" }],
        [VNC_PORT]: [{ HostIp: "127.0.0.1", HostPort: "" }],
      },
      Binds: [`${volumeName(agentId)}:/home/botling`],
      Memory: env.BOTLINGS_COMPUTER_MEMORY_MB * 1024 * 1024,
      NanoCpus: Math.round(env.BOTLINGS_COMPUTER_CPUS * 1e9),
      PidsLimit: 512,
      ShmSize: 512 * 1024 * 1024,
      SecurityOpt: ["no-new-privileges"],
      CapDrop: ["ALL"],
      RestartPolicy: { Name: "no" },
    },
  });
}

async function start(agentId: string): Promise<RunningComputer> {
  if (!(await dockerAvailable())) throw new Error("Docker is not running");
  if (!(await imageExists())) throw new Error("Agent image is missing. Run: pnpm computers:build");

  let info = await inspect(agentId);
  const already = info && endpoints(info);
  if (already) return already;

  await makeRoom(agentId);

  // A stopped container built from an older image is recreated; the home volume is kept.
  if (info) {
    const image = await docker.getImage(env.BOTLINGS_AGENT_IMAGE).inspect();
    if (info.Image !== image.Id) {
      await docker.getContainer(info.Id).remove({ force: true });
      info = null;
    }
  }

  const container = info ? docker.getContainer(info.Id) : await createContainer(agentId);
  await container.start();
  info = await container.inspect();
  const computer = endpoints(info);
  if (!computer) throw new Error("Computer started without published ports");
  await waitForRunner(computer);
  return computer;
}

/** Returns a running computer for the agent, starting it if needed (deduplicated). */
export async function ensureRunning(agentId: string) {
  const r = runtime(agentId);
  r.lastUsed = Date.now();
  if (!r.starting) {
    r.starting = start(agentId).finally(() => {
      r.starting = undefined;
    });
  }
  return r.starting;
}

export async function stopComputer(agentId: string) {
  const info = await inspect(agentId);
  if (info?.State.Running) await docker.getContainer(info.Id).stop({ t: 5 }).catch(() => {});
}

/** Deletes the container and its home volume (used when an agent is deleted). */
export async function destroyComputer(agentId: string) {
  const info = await inspect(agentId);
  if (info) await docker.getContainer(info.Id).remove({ force: true }).catch(() => {});
  await docker.getVolume(volumeName(agentId)).remove().catch(() => {});
  runtimes.delete(agentId);
}

export function touchComputer(agentId: string) {
  runtime(agentId).lastUsed = Date.now();
}

/** Calls the runner API inside the agent's computer. */
export async function callRunner<T>(agentId: string, route: string, body: unknown, timeoutMs = 180_000): Promise<T> {
  const r = runtime(agentId);
  r.busy += 1;
  try {
    const computer = await ensureRunning(agentId);
    const res = await fetch(`${computer.runnerUrl}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-botlings-token": computer.token },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `Runner error ${res.status}`);
    return data;
  } finally {
    r.busy -= 1;
    r.lastUsed = Date.now();
  }
}

// Stop computers that have been idle for a while to free RAM.
globalState.botlingsReaper ??= setInterval(async () => {
  if (!(await dockerAvailable())) return;
  const idleMs = env.BOTLINGS_COMPUTER_IDLE_MINUTES * 60_000;
  for (const agentId of await runningAgentIds().catch(() => [])) {
    const r = runtime(agentId);
    if (r.busy === 0 && !r.starting && Date.now() - r.lastUsed > idleMs) await stopComputer(agentId);
  }
}, 60_000);
globalState.botlingsReaper.unref?.();
