"use server";

import { moveTask, setTaskSize, createTask, type ActionResult } from "@/lib/tasks";
import { getWorkspace } from "@/lib/workspace";
import type { TaskKind } from "@/lib/domain";

export async function moveTaskAction(taskId: string, toStep: number): Promise<ActionResult> {
  return moveTask(taskId, toStep);
}

export async function cycleSizeAction(taskId: string, current: number): Promise<ActionResult> {
  return setTaskSize(taskId, (current % 3) + 1);
}

export async function createTaskAction(form: {
  title: string;
  kind: TaskKind;
  clientId: string | null;
  categoryId: string | null;
  dueAt: string | null;
  size: number;
}): Promise<ActionResult> {
  const ws = await getWorkspace();
  if (!ws || ws.state !== "ready") {
    return { ok: false, message: "Pracovní prostor není připravený." };
  }

  return createTask({
    orgId: ws.orgId,
    title: form.title,
    kind: form.kind,
    clientId: form.clientId,
    categoryId: form.categoryId,
    dueAt: form.dueAt,
    size: form.size,
  });
}
