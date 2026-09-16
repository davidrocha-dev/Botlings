import type { AgentStatus } from "@/components/avatar/botling-options";
import { cn } from "@/lib/cn";

const COLORS: Record<AgentStatus, string> = {
  idle: "bg-success",
  thinking: "bg-accent",
  working: "bg-accent",
  queued: "bg-warning",
  paused: "bg-subtle",
  offline: "bg-subtle",
};

export function StatusDot({ status, className }: { status: AgentStatus; className?: string }) {
  const pulsing = status === "thinking" || status === "working";
  return (
    <span className={cn("relative inline-flex size-2.5 rounded-full ring-2 ring-bg", COLORS[status], className)}>
      {pulsing && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", COLORS[status])} />}
    </span>
  );
}
