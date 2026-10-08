"use server";

import { planTask, type ActionResult } from "@/lib/week-data";

/** Zařadí úkol na den ("RRRR-MM-DD"), nebo plán zruší (`null`). */
export async function planTaskAction(taskId: string, day: string | null): Promise<ActionResult> {
  return planTask(taskId, day);
}
