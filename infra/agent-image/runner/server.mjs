// Botlings agent runner — control API used by the Botlings server to operate this computer.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const PORT = 8080;
const HOME = process.env.HOME ?? "/home/botling";
const WORKSPACE = path.join(HOME, "workspace");
const TOKEN = process.env.BOTLINGS_RUNNER_TOKEN;
const MAX_OUTPUT = 20_000;

if (!TOKEN) {
  console.error("BOTLINGS_RUNNER_TOKEN is required");
  process.exit(1);
}

const truncate = (text, max = MAX_OUTPUT) =>
  text.length > max ? `${text.slice(0, max)}\n… [truncated ${text.length - max} chars]` : text;

/** Resolves a user path inside $HOME; relative paths start at ~/workspace. */
function safePath(input = ".") {
  const resolved = path.resolve(input.startsWith("~") ? path.join(HOME, input.slice(1)) : path.resolve(WORKSPACE, input));
  if (resolved !== HOME && !resolved.startsWith(`${HOME}/`)) throw new HttpError(400, "Path must be inside the home folder");
  return resolved;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- Terminal ----------

const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

function runCommand({ command, timeoutMs = 120_000, env: extraEnv }) {
  if (typeof command !== "string" || !command.trim()) throw new HttpError(400, "command is required");
  const timeout = Math.min(Math.max(Number(timeoutMs) || 120_000, 1_000), 600_000);

  // Secrets are passed per command only (never persisted in the container), and the runner's own
  // token is never exposed to commands.
  const env = { ...process.env };
  delete env.BOTLINGS_RUNNER_TOKEN;
  for (const [key, value] of Object.entries(extraEnv ?? {})) {
    if (ENV_NAME.test(key) && typeof value === "string") env[key] = value;
  }

  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", command], { cwd: WORKSPACE, env });
    let output = "";
    const append = (chunk) => {
      if (output.length < MAX_OUTPUT * 2) output += chunk.toString();
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ exitCode: code, timedOut: signal === "SIGKILL", output: truncate(output) });
    });
  });
}

// ---------- Files ----------

async function readFile({ path: p }) {
  const file = safePath(p);
  const stat = await fs.stat(file);
  if (stat.size > 2_000_000) throw new HttpError(400, "File too large to read (max 2 MB)");
  return { path: file, content: truncate(await fs.readFile(file, "utf8"), 60_000) };
}

async function writeFile({ path: p, content }) {
  if (typeof content !== "string") throw new HttpError(400, "content is required");
  const file = safePath(p);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
  return { path: file, bytes: Buffer.byteLength(content) };
}

async function listFiles({ path: p }) {
  const dir = safePath(p);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return {
    path: dir,
    entries: entries.slice(0, 500).map((e) => `${e.name}${e.isDirectory() ? "/" : ""}`),
  };
}

// ---------- Browser (visible on the VNC screen) ----------

let contextPromise = null;

async function getPage() {
  contextPromise ??= chromium
    .launchPersistentContext(path.join(HOME, ".botlings", "chromium"), {
      executablePath: "/usr/bin/chromium",
      headless: false,
      viewport: null,
      args: ["--no-sandbox", "--test-type", "--start-maximized", "--no-first-run", "--disable-dev-shm-usage"],
    })
    .then((context) => {
      context.on("close", () => (contextPromise = null));
      return context;
    })
    .catch((error) => {
      contextPromise = null;
      throw error;
    });
  const context = await contextPromise;
  const pages = context.pages();
  const page = pages.at(-1) ?? (await context.newPage());
  await page.bringToFront().catch(() => {});
  return page;
}

/**
 * Waits for a page to finish drawing itself. "domcontentloaded" only means the HTML shell arrived:
 * on a site that renders with scripts (flight and price comparators, most dashboards) the results
 * appear seconds later, so a snapshot taken at that moment shows an empty page and the agent concludes
 * the site is broken. Network idle usually marks the end, but ads and trackers keep some pages busy
 * forever, so the text is also polled until it stops growing.
 */
async function settle(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  let previous = -1;
  for (let i = 0; i < 8; i++) {
    const length = await page.evaluate(() => (document.body?.innerText ?? "").length).catch(() => previous);
    if (length === previous && length > 0) return;
    previous = length;
    await page.waitForTimeout(500);
  }
}

/** Numbers visible interactive elements and returns a compact text view of the page. */
async function snapshot(page) {
  await settle(page);
  const data = await page.evaluate(() => {
    const selector = "a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [contenteditable=true]";
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    document.querySelectorAll("[data-botlings-ref]").forEach((el) => el.removeAttribute("data-botlings-ref"));
    const elements = [];
    let n = 0;
    for (const el of document.querySelectorAll(selector)) {
      if (!visible(el) || n >= 150) continue;
      n += 1;
      el.setAttribute("data-botlings-ref", String(n));
      const label = (
        el.getAttribute("aria-label") ||
        el.innerText ||
        el.getAttribute("placeholder") ||
        el.getAttribute("title") ||
        el.getAttribute("name") ||
        el.value ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
      const type = el.tagName.toLowerCase() + (el.type ? `:${el.type}` : "");
      elements.push(`[${n}] ${type} ${label}`);
    }
    const text = (document.body?.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim();
    return { title: document.title, elements, text };
  });
  // A page that draws nothing even after settling is usually blocking automated browsers: say so, so the
  // agent reports it and moves on instead of spending the rest of its turn reloading the same wall.
  const blocked = !data.text && !data.elements.length;
  return {
    url: page.url(),
    title: data.title,
    elements: data.elements.join("\n"),
    text: blocked
      ? "(this page returned no text and no elements — it is most likely blocking automated browsers: ask the user to take the screen instead of reloading it)"
      : truncate(data.text, 8_000),
  };
}

async function browserOpen({ url }) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) throw new HttpError(400, "url must start with http(s)://");
  const page = await getPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  return snapshot(page);
}

/** Brings the browser window up for the user (starts it on a search page if it was empty). */
async function browserShow() {
  const page = await getPage();
  if (page.url() === "about:blank") await page.goto("https://duckduckgo.com", { waitUntil: "domcontentloaded" }).catch(() => {});
  return { url: page.url() };
}

async function browserSnapshot() {
  return snapshot(await getPage());
}

async function locate(page, ref) {
  const locator = page.locator(`[data-botlings-ref="${Number(ref)}"]`);
  if ((await locator.count()) === 0) throw new HttpError(400, `Element [${ref}] not found — take a new snapshot`);
  return locator.first();
}

/**
 * Describes an element before acting on it, so the Botlings server can decide whether the action
 * needs the user's approval (e.g. a "Place order" button or a password field).
 */
async function browserDescribe({ ref }) {
  const page = await getPage();
  const el = await locate(page, ref);
  const info = await el.evaluate((node) => {
    const form = node.closest("form");
    const text = (s) => (s || "").replace(/\s+/g, " ").trim().slice(0, 120);
    return {
      tag: node.tagName.toLowerCase(),
      type: (node.getAttribute("type") || "").toLowerCase(),
      label: text(
        node.getAttribute("aria-label") ||
          node.innerText ||
          node.getAttribute("value") ||
          node.getAttribute("placeholder") ||
          node.getAttribute("title") ||
          node.getAttribute("name"),
      ),
      autocomplete: (node.getAttribute("autocomplete") || "").toLowerCase(),
      name: text(node.getAttribute("name") || node.getAttribute("id")),
      formAction: form ? text(form.getAttribute("action")) : "",
      formHasPassword: form ? !!form.querySelector("input[type=password]") : false,
    };
  });
  return { ...info, url: page.url() };
}

async function browserClick({ ref }) {
  const page = await getPage();
  await (await locate(page, ref)).click({ timeout: 10_000 });
  await page.waitForTimeout(800);
  return snapshot(page);
}

async function browserType({ ref, text, submit = false }) {
  if (typeof text !== "string") throw new HttpError(400, "text is required");
  const page = await getPage();
  const el = await locate(page, ref);
  await el.fill(text, { timeout: 10_000 });
  if (submit) await el.press("Enter");
  await page.waitForTimeout(800);
  return snapshot(page);
}

// ---------- HTTP ----------

const routes = {
  "POST /exec": runCommand,
  "POST /files/read": readFile,
  "POST /files/write": writeFile,
  "POST /files/list": listFiles,
  "POST /browser/open": browserOpen,
  "POST /browser/show": browserShow,
  "POST /browser/snapshot": browserSnapshot,
  "POST /browser/describe": browserDescribe,
  "POST /browser/click": browserClick,
  "POST /browser/type": browserType,
};

/** True for loopback and any address of this container's own interfaces. */
function isLocalAddress(address = "") {
  const ip = address.replace(/^::ffff:/, "");
  if (ip === "::1" || ip.startsWith("127.")) return true;
  return Object.values(networkInterfaces())
    .flat()
    .some((iface) => iface && iface.address === ip);
}

const server = createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.method === "GET" && req.url === "/health") return send(200, { ok: true });

  // Requests from inside the container (the agent's own commands) could bypass the Botlings
  // server's approval checks, so only harmless routes are accepted from a local address.
  if (isLocalAddress(req.socket.remoteAddress)) {
    if (req.method === "POST" && req.url === "/browser/show") {
      try {
        return send(200, await browserShow());
      } catch (error) {
        return send(500, { error: error.message ?? String(error) });
      }
    }
    return send(403, { error: "Forbidden from inside the computer" });
  }
  if (req.headers["x-botlings-token"] !== TOKEN) return send(401, { error: "Unauthorized" });

  const handler = routes[`${req.method} ${req.url}`];
  if (!handler) return send(404, { error: "Not found" });

  try {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 5_000_000) throw new HttpError(413, "Body too large");
    }
    const result = await handler(raw ? JSON.parse(raw) : {});
    send(200, result);
  } catch (error) {
    send(error.status ?? 500, { error: error.message ?? String(error) });
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`runner listening on ${PORT}`));
