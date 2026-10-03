"use server";

import {
  disconnectMailbox,
  ignoreSender,
  setHandled,
  syncMailbox,
  taskFromMail,
  unignore,
  type ActionResult,
} from "@/lib/mail-data";
import { getWorkspace } from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";

const NOT_READY: ActionResult = { ok: false, message: "Pracovní prostor není připravený." };

/** Schránka patří konkrétnímu člověku, takže každá akce potřebuje i jeho id. */
async function kdo(): Promise<{ orgId: string; userId: string } | null> {
  const ws = await getWorkspace();
  if (!ws || ws.state !== "ready") return null;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? { orgId: ws.orgId, userId: user.id } : null;
}

export async function syncMailAction(): Promise<ActionResult & { count?: number }> {
  const k = await kdo();
  if (!k) return NOT_READY;
  return syncMailbox(k.orgId, k.userId);
}

export async function disconnectMailAction(): Promise<ActionResult> {
  const k = await kdo();
  if (!k) return NOT_READY;
  return disconnectMailbox(k.userId);
}

export async function setHandledAction(id: string, handled: boolean): Promise<ActionResult> {
  const k = await kdo();
  if (!k) return NOT_READY;
  return setHandled(id, handled);
}

export async function taskFromMailAction(id: string): Promise<ActionResult> {
  const k = await kdo();
  if (!k) return NOT_READY;
  return taskFromMail(k.orgId, k.userId, id);
}

export async function ignoreSenderAction(pattern: string): Promise<ActionResult> {
  const k = await kdo();
  if (!k) return NOT_READY;
  return ignoreSender(k.orgId, k.userId, pattern);
}

export async function unignoreAction(id: string): Promise<ActionResult> {
  const k = await kdo();
  if (!k) return NOT_READY;
  return unignore(id);
}
