import { ChatView } from "@/components/chat/chat-view";

export default async function ConversationPage({ params }: PageProps<"/c/[id]">) {
  const { id } = await params;
  return <ChatView conversationId={id} />;
}
