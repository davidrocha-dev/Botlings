"use client";

import { BotlingAvatar } from "./botling-avatar";
import { moodForStatus } from "./botling-options";
import { StatusDot } from "@/components/ui/status-dot";
import { useStore } from "@/lib/store";
import type { Conversation } from "@/lib/types";

export function ConversationAvatar({
  conversation,
  size = 48,
  showStatus = true,
  animated = false,
}: {
  conversation: Conversation;
  size?: number;
  showStatus?: boolean;
  animated?: boolean;
}) {
  const { getAgent } = useStore();
  const members = conversation.memberIds.map(getAgent).filter((a) => a !== undefined);

  if (conversation.type === "direct" && members[0]) {
    const agent = members[0];
    return (
      <span className="relative inline-flex" style={{ width: size, height: size }}>
        <BotlingAvatar
          appearance={{ ...agent.appearance, mood: moodForStatus(agent.appearance.mood, agent.status) }}
          size={size}
          animated={animated}
          title={agent.name}
        />
        {showStatus && <StatusDot status={agent.status} className="absolute right-0.5 bottom-0.5" />}
      </span>
    );
  }

  // Group: compact cluster of up to 3 member avatars.
  const shown = members.slice(0, 3);
  const small = size * 0.58;
  const positions = [
    { left: 0, top: size * 0.04 },
    { left: size - small, top: size * 0.14 },
    { left: size * 0.22, top: size - small },
  ];
  return (
    <span className="relative inline-block shrink-0 rounded-full bg-surface-2" style={{ width: size, height: size }}>
      {shown.map((agent, i) => (
        <span key={agent.id} className="absolute" style={positions[i]}>
          <BotlingAvatar appearance={agent.appearance} size={small} title={agent.name} />
        </span>
      ))}
    </span>
  );
}
