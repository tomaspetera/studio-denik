"use server";

import {
  createLead,
  updateLead,
  setLeadStatus,
  deleteLead,
  convertLeadToClient,
  type ActionResult,
  type LeadFields,
} from "@/lib/leads";
import { getWorkspace } from "@/lib/workspace";
import type { LeadStatus } from "@/lib/domain";

export async function createLeadAction(form: LeadFields): Promise<ActionResult> {
  const ws = await getWorkspace();
  if (!ws || ws.state !== "ready") {
    return { ok: false, message: "Pracovní prostor není připravený." };
  }
  return createLead({ orgId: ws.orgId, ...form });
}

export async function updateLeadAction(form: LeadFields & { id: string }): Promise<ActionResult> {
  return updateLead(form);
}

export async function setLeadStatusAction(id: string, status: LeadStatus): Promise<ActionResult> {
  return setLeadStatus(id, status);
}

export async function deleteLeadAction(id: string): Promise<ActionResult> {
  return deleteLead(id);
}

export async function convertLeadToClientAction(id: string): Promise<ActionResult & { clientId?: string }> {
  return convertLeadToClient(id);
}
