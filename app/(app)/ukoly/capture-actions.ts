"use server";

import { proposeTasks, createProposedTasks, type ProposeResult, type CreateResult } from "@/lib/capture-data";
import { getWorkspace } from "@/lib/workspace";
import type { Proposal } from "@/lib/capture";

const NOT_READY = { ok: false, message: "Pracovní prostor není připravený." } as const;

export async function proposeTasksAction(text: string): Promise<ProposeResult> {
  const ws = await getWorkspace();
  if (!ws || ws.state !== "ready") return NOT_READY;
  return proposeTasks(ws.orgId, text);
}

export async function createProposedTasksAction(items: Proposal[]): Promise<CreateResult> {
  const ws = await getWorkspace();
  if (!ws || ws.state !== "ready") return NOT_READY;
  return createProposedTasks(ws.orgId, items);
}
