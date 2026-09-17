import { GroupError } from "./groups";

export function groupErrorResponse(error: unknown) {
  if (error instanceof GroupError) {
    return Response.json({ error: error.code }, { status: error.code === "not_found" ? 404 : 400 });
  }
  throw error;
}
