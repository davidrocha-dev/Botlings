import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { toMessageDto } from "@/server/data";

/** Inserts a message and bumps the conversation's updatedAt. */
export async function saveMessage(values: typeof schema.messages.$inferInsert) {
  const [row] = await db.insert(schema.messages).values(values).returning();
  await db
    .update(schema.conversations)
    .set({ updatedAt: new Date() })
    .where(eq(schema.conversations.id, values.conversationId));
  return toMessageDto(row);
}
