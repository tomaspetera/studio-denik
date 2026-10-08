"use server";

import { recordClientNudge, type ActionResult } from "@/lib/waiting-data";

/** Zápis do historie úkolu, že se u klienta urgovalo. Nic se neposílá. */
export async function recordNudgeAction(taskId: string): Promise<ActionResult> {
  return recordClientNudge(taskId);
}
