"use server";

import { setNextStep, setSilenceDays, type ActionResult } from "@/lib/next-step";
import { getWorkspace } from "@/lib/workspace";

export async function setNextStepAction(input: {
  subject: "client" | "lead";
  id: string;
  step: string | null;
  at: string | null;
}): Promise<ActionResult> {
  return setNextStep(input);
}

export async function setSilenceDaysAction(days: number): Promise<ActionResult> {
  const ws = await getWorkspace();
  if (!ws || ws.state !== "ready") {
    return { ok: false, message: "Pracovní prostor není připravený." };
  }
  return setSilenceDays(ws.orgId, days);
}
