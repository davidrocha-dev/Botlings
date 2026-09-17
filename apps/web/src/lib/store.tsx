"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { AgentStatus } from "@/components/avatar/botling-options";
import type { Agent, Bootstrap, ChatStreamEvent, Conversation, Message } from "./types";

type Draft = { id: string; agentId: string; text: string };

type StoreValue = {
  user: Bootstrap["user"];
  defaultModel: string;
  agents: Agent[];
  conversations: Conversation[];
  /** Loaded message history per conversation (undefined = not loaded yet). */
  messagesByConversation: Record<string, Message[] | undefined>;
  drafts: Record<string, Draft | null>;
  /** Bumped whenever an agent's computer may have changed state (used to refresh live views). */
  computerTicks: Record<string, number>;
  typing: Record<string, string | null>;
  infoOpen: boolean;
  setInfoOpen: (open: boolean) => void;
  getAgent: (id: string) => Agent | undefined;
  loadMessages: (conversationId: string) => Promise<void>;
  sendMessage: (conversationId: string, text: string) => Promise<void>;
  markRead: (conversationId: string) => void;
  addAgent: (agent: Agent, conversation: Conversation) => void;
  upsertAgent: (agent: Agent) => void;
  /** Adds or replaces a message (e.g. a card whose status changed). */
  applyMessage: (message: Message) => void;
  /** Drops a deleted agent, its removed conversations, and its group memberships. */
  removeAgent: (agentId: string, removedConversationIds: string[]) => void;
  /** Adds or replaces a conversation (keeps its unread count and last message if newer). */
  upsertConversation: (conversation: Conversation) => void;
  removeConversation: (conversationId: string) => void;
};

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ initial, children }: { initial: Bootstrap; children: React.ReactNode }) {
  const [agents, setAgents] = useState(initial.agents);
  const [conversations, setConversations] = useState(initial.conversations);
  const [messagesByConversation, setMessages] = useState<Record<string, Message[] | undefined>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft | null>>({});
  const [typing, setTyping] = useState<Record<string, string | null>>({});
  const [busyAgents, setBusyAgents] = useState<Record<string, AgentStatus>>({});
  const [infoOpen, setInfoOpen] = useState(false);
  const [computerTicks, setComputerTicks] = useState<Record<string, number>>({});
  const loading = useRef(new Set<string>());

  // The details panel starts open only where it fits as a third column.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (window.matchMedia("(min-width: 1280px)").matches) setInfoOpen(true);
  }, []);

  const agentsWithStatus = useMemo(
    () => agents.map((a) => (busyAgents[a.id] ? { ...a, status: busyAgents[a.id] } : a)),
    [agents, busyAgents],
  );
  const getAgent = useCallback((id: string) => agentsWithStatus.find((a) => a.id === id), [agentsWithStatus]);

  const upsertAgent = useCallback((agent: Agent) => {
    setAgents((list) => (list.some((a) => a.id === agent.id) ? list.map((a) => (a.id === agent.id ? agent : a)) : [...list, agent]));
  }, []);

  /** Adds a message, or replaces it when it already exists (e.g. a task card whose status changed). */
  const appendMessage = useCallback((message: Message) => {
    setMessages((map) => {
      const list = map[message.conversationId];
      if (!list) return map;
      const index = list.findIndex((m) => m.id === message.id);
      if (index === -1) return { ...map, [message.conversationId]: [...list, message] };
      const next = list.slice();
      next[index] = message;
      return { ...map, [message.conversationId]: next };
    });
    setConversations((list) =>
      list.map((c) => {
        if (c.id !== message.conversationId) return c;
        const isUpdate = c.lastMessage?.id === message.id;
        const isNewer = !c.lastMessage || message.createdAt >= c.lastMessage.createdAt;
        return isUpdate || isNewer ? { ...c, lastMessage: message } : c;
      }),
    );
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    if (loading.current.has(conversationId)) return;
    loading.current.add(conversationId);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`);
      if (!res.ok) return;
      const { messages } = (await res.json()) as { messages: Message[] };
      setMessages((map) => ({ ...map, [conversationId]: messages }));
    } finally {
      loading.current.delete(conversationId);
    }
  }, []);

  const markRead = useCallback((conversationId: string) => {
    setConversations((list) => list.map((c) => (c.id === conversationId && c.unread ? { ...c, unread: 0 } : c)));
    void fetch(`/api/conversations/${conversationId}/read`, { method: "POST" });
  }, []);

  const handleEvent = useCallback(
    (conversationId: string, event: ChatStreamEvent) => {
      switch (event.type) {
        case "user_message":
          appendMessage(event.message);
          break;
        case "typing":
          setTyping((t) => ({ ...t, [conversationId]: event.agentId }));
          setBusyAgents((b) => ({ ...b, [event.agentId]: "thinking" }));
          break;
        case "delta":
          setTyping((t) => ({ ...t, [conversationId]: null }));
          setBusyAgents((b) => ({ ...b, [event.agentId]: "working" }));
          setDrafts((d) => {
            const current = d[conversationId];
            const text = (current?.id === event.messageId ? current.text : "") + event.text;
            return { ...d, [conversationId]: { id: event.messageId, agentId: event.agentId, text } };
          });
          break;
        case "message":
          if (event.message.kind !== "event") {
            setDrafts((d) => ({ ...d, [conversationId]: null }));
            setTyping((t) => ({ ...t, [conversationId]: null }));
          }
          appendMessage(event.message);
          break;
        case "agent":
          upsertAgent(event.agent);
          break;
        case "computer":
          setComputerTicks((c) => ({ ...c, [event.agentId]: (c[event.agentId] ?? 0) + 1 }));
          break;
        case "done":
          break;
      }
    },
    [appendMessage, upsertAgent],
  );

  // Live updates for background work (delegated tasks, the orchestrator's follow-up summary).
  const messagesRef = useRef(messagesByConversation);
  useEffect(() => {
    messagesRef.current = messagesByConversation;
  }, [messagesByConversation]);

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (raw) => {
      let data: { conversationId: string; event: ChatStreamEvent };
      try {
        data = JSON.parse(raw.data);
      } catch {
        return;
      }
      const { conversationId, event } = data;
      handleEvent(conversationId, event);

      const endsTurn = event.type === "agent" || (event.type === "message" && event.message.kind === "error");
      if (endsTurn) {
        const agentId = event.type === "agent" ? event.agent.id : event.message.author.type === "agent" ? event.message.author.agentId : null;
        setTyping((t) => ({ ...t, [conversationId]: null }));
        setDrafts((d) => ({ ...d, [conversationId]: null }));
        if (agentId) {
          setBusyAgents((b) => {
            const next = { ...b };
            delete next[agentId];
            return next;
          });
        }
      }
      // Unopened conversations get an unread badge for new agent replies.
      if (event.type === "message" && event.message.kind === "text" && event.message.author.type === "agent" && !messagesRef.current[conversationId]) {
        setConversations((list) => list.map((c) => (c.id === conversationId ? { ...c, unread: c.unread + 1 } : c)));
      }
    };
    return () => source.close();
  }, [handleEvent]);

  const sendMessage = useCallback(
    async (conversationId: string, text: string) => {
      const clearBusy = () => {
        setTyping((t) => ({ ...t, [conversationId]: null }));
        setDrafts((d) => ({ ...d, [conversationId]: null }));
        const conversation = conversations.find((c) => c.id === conversationId);
        setBusyAgents((b) => {
          const next = { ...b };
          conversation?.memberIds.forEach((id) => delete next[id]);
          return next;
        });
      };

      try {
        const res = await fetch(`/api/conversations/${conversationId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok || !res.body) throw new Error(String(res.status));

        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let newline: number;
          while ((newline = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line) handleEvent(conversationId, JSON.parse(line) as ChatStreamEvent);
          }
        }
      } finally {
        clearBusy();
      }
    },
    [conversations, handleEvent],
  );

  const removeAgent = useCallback((agentId: string, removedConversationIds: string[]) => {
    const removed = new Set(removedConversationIds);
    setAgents((list) => list.filter((a) => a.id !== agentId));
    setConversations((list) =>
      list
        .filter((c) => !removed.has(c.id))
        .map((c) => (c.memberIds.includes(agentId) ? { ...c, memberIds: c.memberIds.filter((id) => id !== agentId) } : c)),
    );
    setMessages((map) => {
      const next = { ...map };
      for (const id of removed) delete next[id];
      return next;
    });
  }, []);

  const upsertConversation = useCallback((conversation: Conversation) => {
    setConversations((list) => {
      const current = list.find((c) => c.id === conversation.id);
      if (!current) return [conversation, ...list];
      const lastMessage =
        (current.lastMessage?.createdAt ?? 0) > (conversation.lastMessage?.createdAt ?? 0) ? current.lastMessage : conversation.lastMessage;
      return list.map((c) => (c.id === conversation.id ? { ...conversation, unread: current.unread, lastMessage } : c));
    });
  }, []);

  const removeConversation = useCallback((conversationId: string) => {
    setConversations((list) => list.filter((c) => c.id !== conversationId));
    setMessages((map) => {
      const next = { ...map };
      delete next[conversationId];
      return next;
    });
  }, []);

  const addAgent = useCallback(
    (agent: Agent, conversation: Conversation) => {
      upsertAgent(agent);
      setConversations((list) => [conversation, ...list]);
    },
    [upsertAgent],
  );

  const value = useMemo(
    () => ({
      user: initial.user,
      defaultModel: initial.defaultModel,
      agents: agentsWithStatus,
      conversations,
      messagesByConversation,
      drafts,
      computerTicks,
      typing,
      infoOpen,
      setInfoOpen,
      getAgent,
      loadMessages,
      sendMessage,
      markRead,
      addAgent,
      upsertAgent,
      removeAgent,
      upsertConversation,
      removeConversation,
      applyMessage: appendMessage,
    }),
    [
      initial.user,
      initial.defaultModel,
      agentsWithStatus,
      conversations,
      messagesByConversation,
      drafts,
      computerTicks,
      typing,
      infoOpen,
      getAgent,
      loadMessages,
      sendMessage,
      markRead,
      addAgent,
      upsertAgent,
      removeAgent,
      upsertConversation,
      removeConversation,
      appendMessage,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}
