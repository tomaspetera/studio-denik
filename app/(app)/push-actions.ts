"use server";

import { saveSubscription, removeSubscription, type ActionResult } from "@/lib/push";
import { getWorkspace } from "@/lib/workspace";

export async function subscribePushAction(sub: {
  endpoint: string;
  p256dh: string;
  auth: string;
}): Promise<ActionResult> {
  const ws = await getWorkspace();
  if (!ws || ws.state !== "ready") {
    return { ok: false, message: "Pracovní prostor není připravený." };
  }
  return saveSubscription({ orgId: ws.orgId, ...sub });
}

export async function unsubscribePushAction(endpoint: string): Promise<ActionResult> {
  return removeSubscription(endpoint);
}
