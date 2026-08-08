"use server";

import { getWorkspace } from "@/lib/workspace";
import {
  savePrintDetails,
  confirmDelivery,
  logNudge,
  type ActionResult,
} from "@/lib/print";

async function orgOrFail(): Promise<{ orgId: string } | { error: ActionResult }> {
  const ws = await getWorkspace();
  if (!ws || ws.state !== "ready") {
    return { error: { ok: false, message: "Pracovní prostor není připravený." } };
  }
  return { orgId: ws.orgId };
}

export async function saveDetailsAction(
  taskId: string,
  fields: {
    code: string;
    spec: string;
    quantity: number | null;
    sentAt: string | null;
    promisedAt: string | null;
  },
): Promise<ActionResult> {
  const res = await orgOrFail();
  if ("error" in res) return res.error;
  return savePrintDetails(res.orgId, taskId, fields);
}

export async function confirmDeliveryAction(taskId: string): Promise<ActionResult> {
  const res = await orgOrFail();
  if ("error" in res) return res.error;
  return confirmDelivery(res.orgId, taskId);
}

export async function nudgeAction(taskId: string): Promise<ActionResult> {
  const res = await orgOrFail();
  if ("error" in res) return res.error;
  return logNudge(res.orgId, taskId);
}
