export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { runMigrations } = await import("./server/db/migrate");
  await runMigrations();
  const { failInterruptedTasks } = await import("./server/chat/tasks");
  await failInterruptedTasks().catch((error) => console.error("[tasks] startup cleanup", error));
}
