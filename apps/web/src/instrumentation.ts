export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { runMigrations } = await import("./server/db/migrate");
  await runMigrations();
  const { failInterruptedTasks } = await import("./server/chat/tasks");
  await failInterruptedTasks().catch((error) => console.error("[tasks] startup cleanup", error));
  const { expireStaleApprovals } = await import("./server/approvals/approvals");
  await expireStaleApprovals().catch((error) => console.error("[approvals] startup cleanup", error));
  const { notify } = await import("./server/notifications/notify");
  const { onRoutineFinished, startScheduler } = await import("./server/routines/routines");
  onRoutineFinished((run) =>
    notify(run.ownerId, {
      type: "routine",
      routineName: run.routineName,
      status: run.status,
      summary: run.summary,
      conversationId: run.conversationId,
    }),
  );
  await startScheduler().catch((error) => console.error("[routines] scheduler", error));
}
