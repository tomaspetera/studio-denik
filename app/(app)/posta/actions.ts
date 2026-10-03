"use server";

import {
  createTasksFromMail,
  disconnectMailbox,
  ignoreSender,
  proposeFromMail,
  setHandled,
  setMailAiConsent,
  syncMailbox,
  taskFromMail,
  unignore,
  type ActionResult,
  type MailProposeResult,
} from "@/lib/mail-data";
import type { Proposal } from "@/lib/capture";
import { getWorkspace } from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";

const NOT_READY = { ok: false, message: "Pracovní prostor není připravený." } as const;

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

/** Zapnutí nebo vypnutí návrhu úkolu pomocí AI — souhlas majitele schránky. */
export async function setMailAiConsentAction(on: boolean): Promise<ActionResult> {
  const k = await kdo();
  if (!k) return NOT_READY;
  return setMailAiConsent(k.userId, on === true);
}

/** AI přečte tuhle jednu zprávu a navrhne úkoly. Nic nezakládá. */
export async function proposeFromMailAction(id: string): Promise<MailProposeResult> {
  const k = await kdo();
  if (!k) return NOT_READY;
  return proposeFromMail(k.orgId, k.userId, id);
}

export async function createTasksFromMailAction(id: string, items: Proposal[]): Promise<ActionResult & { created?: number }> {
  const k = await kdo();
  if (!k) return NOT_READY;
  return createTasksFromMail(k.orgId, k.userId, id, items);
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
