import "server-only";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "./supabase/server";

export type ActionResult = { ok: true } | { ok: false; message: string };

export async function createClientNote(input: {
  orgId: string;
  clientId: string;
  body: string;
}): Promise<ActionResult> {
  const body = input.body.trim();
  if (!body) return { ok: false, message: "Poznámka potřebuje text." };

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase.from("client_notes").insert({
    org_id: input.orgId,
    client_id: input.clientId,
    body,
    created_by: user?.id ?? null,
  });

  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateClientNote(input: { id: string; body: string }): Promise<ActionResult> {
  const body = input.body.trim();
  if (!body) return { ok: false, message: "Poznámka potřebuje text." };

  const supabase = await supabaseServer();
  const { error } = await supabase.from("client_notes").update({ body }).eq("id", input.id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteClientNote(id: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("client_notes").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}
