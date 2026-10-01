"use server";

import {
  createTemplate,
  updateTemplate,
  deleteTemplate,
  type ActionResult,
  type TemplateFields,
} from "@/lib/templates";
import {
  createRecurring,
  updateRecurring,
  setRecurringActive,
  deleteRecurring,
  type RecurringFields,
} from "@/lib/recurring";
import { getWorkspace } from "@/lib/workspace";

async function orgIdOrNull(): Promise<string | null> {
  const ws = await getWorkspace();
  return ws && ws.state === "ready" ? ws.orgId : null;
}

const NOT_READY: ActionResult = { ok: false, message: "Pracovní prostor není připravený." };

export async function createTemplateAction(form: TemplateFields): Promise<ActionResult> {
  const orgId = await orgIdOrNull();
  if (!orgId) return NOT_READY;
  return createTemplate({ orgId, ...form });
}

export async function updateTemplateAction(form: TemplateFields & { id: string }): Promise<ActionResult> {
  return updateTemplate(form);
}

export async function deleteTemplateAction(id: string): Promise<ActionResult> {
  return deleteTemplate(id);
}

export async function createRecurringAction(form: RecurringFields): Promise<ActionResult> {
  const orgId = await orgIdOrNull();
  if (!orgId) return NOT_READY;
  return createRecurring({ orgId, ...form });
}

export async function updateRecurringAction(form: RecurringFields & { id: string }): Promise<ActionResult> {
  const orgId = await orgIdOrNull();
  if (!orgId) return NOT_READY;
  return updateRecurring({ orgId, ...form });
}

export async function setRecurringActiveAction(id: string, active: boolean): Promise<ActionResult> {
  const orgId = await orgIdOrNull();
  if (!orgId) return NOT_READY;
  return setRecurringActive(id, orgId, active);
}

export async function deleteRecurringAction(id: string): Promise<ActionResult> {
  return deleteRecurring(id);
}
