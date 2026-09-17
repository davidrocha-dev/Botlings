import { EditGroup } from "@/components/groups/group-form";

export default async function EditGroupPage({ params }: PageProps<"/groups/[id]/edit">) {
  const { id } = await params;
  return <EditGroup groupId={id} />;
}
