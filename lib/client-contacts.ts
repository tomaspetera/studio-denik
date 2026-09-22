import "server-only";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "./supabase/server";

/**
 * Další kontakty na klienta — vedle stávajícího jednoho pole
 * `clients.contact`/`clients.email`, které zůstává jako rychlý/hlavní
 * kontakt. Reálný klient má často víc lidí (jednatel, grafik na jejich
 * straně, marketing), a appka dřív uměla pojmout jen jednoho.
 */
export type ClientContact = {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
};

export async function listClientContacts(clientId: string): Promise<ClientContact[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("client_contacts")
    .select("id, name, role, phone, email")
    .eq("client_id", clientId)
    .order("position")
    .order("created_at");
  return (data ?? []) as ClientContact[];
}

/**
 * Všechny kontakty organizace najednou, seskupené podle klienta — appka
 * načítá vše dopředu (klientů je málo), stejně jako zbytek aplikace.
 */
export async function listAllClientContacts(orgId: string): Promise<Record<string, ClientContact[]>> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("client_contacts")
    .select("id, client_id, name, role, phone, email")
    .eq("org_id", orgId)
    .order("position")
    .order("created_at");

  const byClient: Record<string, ClientContact[]> = {};
  for (const row of (data ?? []) as (ClientContact & { client_id: string })[]) {
    const { client_id, ...contact } = row;
    (byClient[client_id] ??= []).push(contact);
  }
  return byClient;
}

export type ActionResult = { ok: true } | { ok: false; message: string };

export async function createClientContact(input: {
  orgId: string;
  clientId: string;
  name: string;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
}): Promise<ActionResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "Kontakt potřebuje jméno." };

  const supabase = await supabaseServer();
  const { error } = await supabase.from("client_contacts").insert({
    org_id: input.orgId,
    client_id: input.clientId,
    name,
    role: input.role?.trim() || null,
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
  });

  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateClientContact(input: {
  id: string;
  name: string;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
}): Promise<ActionResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "Kontakt potřebuje jméno." };

  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("client_contacts")
    .update({
      name,
      role: input.role?.trim() || null,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
    })
    .eq("id", input.id);

  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteClientContact(id: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("client_contacts").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}
