/**
 * Decides whether an agent's computer action needs the user's approval.
 *
 * Categories are stable identifiers (used for "always allow" rules and translated in the UI).
 * The rules err on the side of asking: a false positive costs one click, a false negative could
 * send an email or buy something.
 */

export type Autonomy = "ask_always" | "ask_sensitive" | "autonomous";

export type ElementInfo = {
  tag: string;
  type: string;
  label: string;
  autocomplete: string;
  name: string;
  formAction: string;
  formHasPassword: boolean;
  url: string;
};

export type Classification =
  | { decision: "allow" }
  /** Never allowed, not even with approval (e.g. typing a password). */
  | { decision: "block"; category: string; reason: string }
  | { decision: "ask"; category: string; detail: string };

const READ_ONLY_TOOLS = new Set(["read_file", "list_files", "browser_snapshot"]);

const COMMAND_RULES: { category: string; pattern: RegExp }[] = [
  { category: "delete_files", pattern: /\brm\s+(-[a-z]*[rf][a-z]*\s+)+|\bshred\b|\bmkfs\b|\bdd\s+if=|\btruncate\s+-s\s*0\b|\bgit\s+clean\s+-[a-z]*f/i },
  { category: "publish", pattern: /\bgit\s+push\b|\b(npm|pnpm|yarn)\s+publish\b|\bdocker\s+push\b|\bgh\s+(pr|release|repo|issue)\s+(create|merge|delete|close)\b|\btwine\s+upload\b|\bvercel\b.*--prod|\bnetlify\s+deploy\b/i },
  { category: "send_data", pattern: /\bcurl\b.*(\s-X\s*(POST|PUT|PATCH|DELETE)\b|\s(-d|--data[a-z-]*|-F|--form|-T|--upload-file)\b)|\bwget\b.*--post-(data|file)|\b(sendmail|mailx?|mutt|swaks|msmtp)\b|\bhttp(ie)?\s+(POST|PUT|PATCH|DELETE)\b|\bssh\b|\bscp\b|\brsync\b.*:/i },
  { category: "payments", pattern: /\bstripe\b|\bpaypal\b|\bcheckout\b/i },
];

const ELEMENT_RULES: { category: string; pattern: RegExp }[] = [
  { category: "purchase", pattern: /\b(buy|purchase|pay|payment|checkout|check out|place (your )?order|order now|subscribe|upgrade|donate|add card|comprar|pagar|pagamento|finalizar (a )?compra|encomendar|subscrever|assinar|doar)\b/i },
  { category: "delete", pattern: /\b(delete|remove|erase|deactivate|close account|cancel (my )?(account|subscription)|eliminar|apagar|remover|desativar)\b/i },
  { category: "send_publish", pattern: /\b(send|submit|post|publish|tweet|reply|share|comment|upload|confirm|enviar|submeter|publicar|partilhar|comentar|responder|carregar|confirmar)\b/i },
  { category: "account", pattern: /\b(sign up|register|create (an )?account|join now|registar|registrar|criar conta|inscrever)\b/i },
  { category: "consent", pattern: /\b(accept|agree|allow|authori[sz]e|grant|aceitar|concordar|permitir|autorizar)\b/i },
];

function describeCommand(command: string) {
  return command.length > 300 ? `${command.slice(0, 300)}…` : command;
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function isCredentialField(el: ElementInfo) {
  return (
    el.type === "password" ||
    /password|passwd|current-password|new-password|one-time-code|cc-number|cc-csc/.test(el.autocomplete) ||
    /pass(word)?|pwd|cvv|cvc|card.?number|iban|pin\b/i.test(el.name)
  );
}

/**
 * @param element required for browser_click / browser_type (described by the runner beforehand).
 */
export function classifyAction(opts: {
  tool: string;
  args: Record<string, unknown>;
  autonomy: Autonomy;
  element?: ElementInfo | null;
}): Classification {
  const { tool, args, autonomy, element } = opts;

  // Hard rule in every autonomy level: agents never type credentials or card details.
  if (tool === "browser_type" && element && isCredentialField(element)) {
    return { decision: "block", category: "credentials", reason: "Agents never type passwords, codes or card details." };
  }

  let sensitive: { category: string; detail: string } | null = null;

  if (tool === "run_command") {
    const command = String(args.command ?? "");
    const rule = COMMAND_RULES.find((r) => r.pattern.test(command));
    if (rule) sensitive = { category: rule.category, detail: describeCommand(command) };
  } else if ((tool === "browser_click" || (tool === "browser_type" && args.submit === true)) && !element) {
    // Couldn't inspect the element: don't guess, ask.
    sensitive = { category: "browser_action", detail: `${tool} [${String(args.ref ?? "?")}]` };
  } else if ((tool === "browser_click" || (tool === "browser_type" && args.submit === true)) && element) {
    const haystack = `${element.label} ${element.name} ${element.formAction}`;
    const rule = ELEMENT_RULES.find((r) => r.pattern.test(haystack));
    const isSubmit = element.type === "submit" || tool === "browser_type";
    if (rule) {
      sensitive = { category: rule.category, detail: `"${element.label || element.name || element.tag}" — ${hostOf(element.url)}` };
    } else if (isSubmit && element.formHasPassword) {
      sensitive = { category: "account", detail: `Login form — ${hostOf(element.url)}` };
    }
  }

  if (sensitive && autonomy !== "autonomous") return { decision: "ask", ...sensitive };
  if (autonomy === "ask_always" && !READ_ONLY_TOOLS.has(tool)) {
    return { decision: "ask", category: `tool:${tool}`, detail: genericDetail(tool, args, element) };
  }
  return { decision: "allow" };
}

function genericDetail(tool: string, args: Record<string, unknown>, element?: ElementInfo | null) {
  switch (tool) {
    case "run_command":
      return describeCommand(String(args.command ?? ""));
    case "write_file":
      return String(args.path ?? "");
    case "browser_open":
      return String(args.url ?? "");
    case "browser_click":
    case "browser_type":
      return element ? `"${element.label || element.name || element.tag}" — ${hostOf(element.url)}` : `[${String(args.ref ?? "")}]`;
    default:
      return tool;
  }
}
