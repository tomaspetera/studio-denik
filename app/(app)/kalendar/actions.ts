"use server";

import {
  createReminder,
  updateReminder,
  setReminderDone,
  deleteReminder,
  type ActionResult,
} from "@/lib/reminders";
import { setTaskDueDate } from "@/lib/tasks";
import { getWorkspace } from "@/lib/workspace";
import type { DateKey } from "@/lib/domain";

export async function createReminderAction(form: {
  title: string;
  note?: string;
  date: DateKey;
  clientId?: string | null;
}): Promise<ActionResult> {
  const ws = await getWorkspace();
  if (!ws || ws.state !== "ready") {
    return { ok: false, message: "Pracovní prostor není připravený." };
  }
  return createReminder({
    orgId: ws.orgId,
    title: form.title,
    note: form.note,
    date: form.date,
    clientId: form.clientId,
  });
}

export async function updateReminderAction(form: {
  id: string;
  title: string;
  note?: string;
  clientId?: string | null;
}): Promise<ActionResult> {
  return updateReminder(form);
}

export async function setReminderDoneAction(id: string, done: boolean): Promise<ActionResult> {
  return setReminderDone(id, done);
}

export async function deleteReminderAction(id: string): Promise<ActionResult> {
  return deleteReminder(id);
}

/** Přetažení termínu úkolu na jiný den v kalendáři. */
export async function setTaskDueDateAction(taskId: string, dueAt: string | null): Promise<ActionResult> {
  return setTaskDueDate(taskId, dueAt);
}
