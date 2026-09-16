export const BOTLING_SHAPES = ["blob", "round", "square", "drop", "ghost", "flower"] as const;
export type BotlingShape = (typeof BOTLING_SHAPES)[number];

export const BOTLING_MOODS = [
  "happy",
  "neutral",
  "thinking",
  "focused",
  "surprised",
  "sleepy",
  "worried",
  "wink",
] as const;
export type BotlingMood = (typeof BOTLING_MOODS)[number];

export const BOTLING_COLORS = {
  violet: { from: "#a497ff", to: "#5b45f5", ink: "#16112e" },
  sky: { from: "#7fd6ff", to: "#2b7bff", ink: "#0a1a33" },
  mint: { from: "#86f5c6", to: "#14b87a", ink: "#062a1c" },
  lemon: { from: "#fff08a", to: "#f5b700", ink: "#332600" },
  sunset: { from: "#ffc27a", to: "#ff5e3a", ink: "#331006" },
  pink: { from: "#ffa6e1", to: "#e8479f", ink: "#330b21" },
  coral: { from: "#ffa3a3", to: "#e84a5f", ink: "#330a10" },
  slate: { from: "#c3cadb", to: "#5f6880", ink: "#12141c" },
  ink: { from: "#6b6b85", to: "#22222f", ink: "#f2f2f7" },
} as const;
export type BotlingColor = keyof typeof BOTLING_COLORS;
export const BOTLING_COLOR_KEYS = Object.keys(BOTLING_COLORS) as BotlingColor[];

export type BotlingAppearance = {
  shape: BotlingShape;
  color: BotlingColor;
  mood: BotlingMood;
};

/** Agent runtime state → avatar expression. */
export type AgentStatus = "idle" | "thinking" | "working" | "queued" | "paused" | "offline";

export function moodForStatus(base: BotlingMood, status: AgentStatus): BotlingMood {
  switch (status) {
    case "thinking":
      return "thinking";
    case "working":
      return "focused";
    case "paused":
    case "offline":
      return "sleepy";
    default:
      return base;
  }
}

export function randomAppearance(): BotlingAppearance {
  const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];
  return { shape: pick(BOTLING_SHAPES), color: pick(BOTLING_COLOR_KEYS), mood: pick(BOTLING_MOODS) };
}
