"use server";

import { getWorkspace } from "@/lib/workspace";
import { generateSummary, saveEdit, publishReport, type GenerateResult } from "@/lib/report";
import type { Provider } from "@/lib/ai";

export async function generateAction(provider?: Provider): Promise<GenerateResult> {
  const ws = await getWorkspace();
  if (!ws || ws.state !== "ready") {
    return { ok: false, message: "Pracovní prostor není připravený." };
  }
  return generateSummary(ws.orgId, provider);
}

export async function saveEditAction(reportId: string, text: string): Promise<void> {
  await saveEdit(reportId, text);
}

export async function publishAction(reportId: string, recipient: string): Promise<void> {
  await publishReport(reportId, recipient);
}
