/** Slash commands offered in the composer. Keep in sync with server/chat/commands.ts. */
export type ChatCommand = {
  key: "new" | "stop" | "status" | "cost" | "model" | "memory" | "routines" | "routine" | "approvals" | "help";
  en: string;
  pt: string;
  /** Takes an argument: picking it fills "/name " instead of sending. */
  args?: boolean;
};

export const CHAT_COMMANDS: ChatCommand[] = [
  { key: "new", en: "new", pt: "novo" },
  { key: "stop", en: "stop", pt: "parar" },
  { key: "status", en: "status", pt: "estado" },
  { key: "approvals", en: "approvals", pt: "aprovacoes" },
  { key: "cost", en: "cost", pt: "custo" },
  { key: "model", en: "model", pt: "modelo", args: true },
  { key: "memory", en: "memory", pt: "memoria" },
  { key: "routines", en: "routines", pt: "rotinas" },
  { key: "routine", en: "routine", pt: "rotina", args: true },
  { key: "help", en: "help", pt: "ajuda" },
];
