import { getCurrentUser } from "@/server/auth/session";
import { getModelCatalog } from "@/server/openrouter";

export async function GET() {
  if (!(await getCurrentUser())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const models = await getModelCatalog();
    return Response.json({ models });
  } catch {
    return Response.json({ error: "Could not load models from OpenRouter" }, { status: 502 });
  }
}
