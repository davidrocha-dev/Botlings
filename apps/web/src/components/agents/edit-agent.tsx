"use client";

import { AgentForm } from "./agent-form";
import { useStore } from "@/lib/store";

export function EditAgent({ agentId }: { agentId: string }) {
  const { getAgent } = useStore();
  const agent = getAgent(agentId);
  if (!agent) return <div className="flex flex-1 items-center justify-center text-muted">404</div>;
  // Keyed so the form's local state resets if another agent is opened.
  return <AgentForm key={agent.id} agent={agent} />;
}
