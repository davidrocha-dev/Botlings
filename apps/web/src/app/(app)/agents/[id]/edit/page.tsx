import { EditAgent } from "@/components/agents/edit-agent";

export default async function EditAgentPage({ params }: PageProps<"/agents/[id]/edit">) {
  const { id } = await params;
  return <EditAgent agentId={id} />;
}
