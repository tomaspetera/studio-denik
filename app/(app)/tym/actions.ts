"use server";

import { getWorkspace } from "@/lib/workspace";
import {
  inviteMember,
  revokeInvite,
  changeRole,
  removeMember,
  type ActionResult,
} from "@/lib/team";
import { createAbsence, deleteAbsence } from "@/lib/absences";
import type { Role, DateKey } from "@/lib/domain";

async function orgOrFail(): Promise<{ orgId: string } | { error: ActionResult }> {
  const ws = await getWorkspace();
  if (!ws || ws.state !== "ready") {
    return { error: { ok: false, message: "Pracovní prostor není připravený." } };
  }
  return { orgId: ws.orgId };
}

export async function inviteAction(email: string, role: Role): Promise<ActionResult> {
  const res = await orgOrFail();
  if ("error" in res) return res.error;
  return inviteMember(res.orgId, email, role);
}

export async function revokeAction(inviteId: string): Promise<ActionResult> {
  return revokeInvite(inviteId);
}

export async function changeRoleAction(userId: string, role: Role): Promise<ActionResult> {
  const res = await orgOrFail();
  if ("error" in res) return res.error;
  return changeRole(res.orgId, userId, role);
}

export async function removeMemberAction(userId: string): Promise<ActionResult> {
  const res = await orgOrFail();
  if ("error" in res) return res.error;
  return removeMember(res.orgId, userId);
}

export async function createAbsenceAction(form: {
  userId: string;
  from: DateKey;
  to: DateKey;
  note: string;
}): Promise<ActionResult> {
  const res = await orgOrFail();
  if ("error" in res) return res.error;
  return createAbsence({ orgId: res.orgId, ...form });
}

export async function deleteAbsenceAction(id: string): Promise<ActionResult> {
  return deleteAbsence(id);
}
