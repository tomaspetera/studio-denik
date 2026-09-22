import "server-only";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "./supabase/server";
import { CLIENT_COLORS, type LeadStatus } from "./domain";

/**
 * Poptávka — krok před založeným klientem. Appka dřív začínala až
 * u klienta; tohle pokrývá to, co se řeší předtím: kdo se ozval, co mu
 * bylo nabídnuto, jestli z toho něco bude.
 */
export type Lead = {
  id: string;
  name: string;
  company: string | null;
  contact: string | null;
  email: string | null;
  phone: string | null;
  amount: number | null;
  status: LeadStatus;
  note: string | null;
  clientId: string | null;
  clientName: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export async function listLeads(orgId: string): Promise<Lead[]> {
  const supabase = await supabaseServer();

  const [{ data: leads }, { data: clients }] = await Promise.all([
    supabase
      .from("leads")
      .select("id, name, company, contact, email, phone, amount, status, note, client_id, created_at, decided_at")
      .eq("org_id", orgId)
      .order("created_at"),
    // Jen na dohledání jména u už převedené poptávky — klientů je málo,
    // stejné "načti všechno" jako všude jinde v appce.
    supabase.from("clients").select("id, name").eq("org_id", orgId),
  ]);

  const nameByClientId = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));

  type Row = {
    id: string; name: string; company: string | null; contact: string | null;
    email: string | null; phone: string | null; amount: number | string | null;
    status: LeadStatus; note: string | null; client_id: string | null;
    created_at: string; decided_at: string | null;
  };

  return ((leads ?? []) as unknown as Row[]).map((l) => ({
    id: l.id,
    name: l.name,
    company: l.company,
    contact: l.contact,
    email: l.email,
    phone: l.phone,
    amount: l.amount === null ? null : Number(l.amount),
    status: l.status,
    note: l.note,
    clientId: l.client_id,
    clientName: l.client_id ? (nameByClientId.get(l.client_id) ?? null) : null,
    createdAt: l.created_at,
    decidedAt: l.decided_at,
  }));
}

export type ActionResult = { ok: true } | { ok: false; message: string };

export type LeadFields = {
  name: string;
  company?: string | null;
  contact?: string | null;
  email?: string | null;
  phone?: string | null;
  amount?: number | null;
  note?: string | null;
};

function toRow(input: LeadFields) {
  return {
    name: input.name.trim(),
    company: input.company?.trim() || null,
    contact: input.contact?.trim() || null,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    amount: input.amount ?? null,
    note: input.note?.trim() || null,
  };
}

export async function createLead(input: LeadFields & { orgId: string }): Promise<ActionResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "Poptávka potřebuje název." };

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase.from("leads").insert({
    org_id: input.orgId,
    created_by: user?.id ?? null,
    ...toRow(input),
  });

  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateLead(input: LeadFields & { id: string }): Promise<ActionResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "Poptávka potřebuje název." };

  const supabase = await supabaseServer();
  const { error } = await supabase.from("leads").update(toRow(input)).eq("id", input.id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Přesun mezi stavy. `decided_at` se razítkuje při přechodu na vyhráno
 * nebo prohráno a zase zmizí, když se poptávka vrátí zpátky — stejná
 * dohoda jako `closed_at` u úkolu.
 */
export async function setLeadStatus(id: string, status: LeadStatus): Promise<ActionResult> {
  const decided = status === "vyhrano" || status === "prohrano";
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("leads")
    .update({ status, decided_at: decided ? new Date().toISOString() : null })
    .eq("id", id);

  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteLead(id: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("leads").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Vyhraná poptávka → nový klient. Jméno/kontakt/e-mail se přenesou,
 * poptávka zůstane (jen si zapamatuje, kam vedla) a v historii nového
 * klienta vznikne první záznam — ať je hned vidět, odkud se vzal.
 */
export async function convertLeadToClient(leadId: string): Promise<ActionResult & { clientId?: string }> {
  const supabase = await supabaseServer();

  const { data: lead, error: readErr } = await supabase
    .from("leads")
    .select("org_id, name, company, contact, email, phone, note, amount")
    .eq("id", leadId)
    .single();

  if (readErr || !lead) {
    return { ok: false, message: readErr?.message ?? "Poptávka se nenašla." };
  }

  const { data: existing } = await supabase.from("clients").select("color").eq("org_id", lead.org_id);
  const used = (existing ?? []).map((c) => c.color as string);
  const color = CLIENT_COLORS.find((c) => !used.includes(c)) ?? CLIENT_COLORS[0];

  const clientName = (lead.company?.trim() || lead.name.trim());

  const { data: client, error: cErr } = await supabase
    .from("clients")
    .insert({
      org_id: lead.org_id,
      name: clientName,
      color,
      contact: lead.contact,
      email: lead.email,
    })
    .select("id")
    .single();

  if (cErr || !client) {
    return { ok: false, message: cErr?.message ?? "Klienta se nepodařilo založit." };
  }

  await supabase.from("leads").update({ client_id: client.id }).eq("id", leadId);

  const castka = lead.amount ? ` (${Math.round(Number(lead.amount)).toLocaleString("cs-CZ")} Kč)` : "";
  await supabase.from("client_notes").insert({
    org_id: lead.org_id,
    client_id: client.id,
    body: `Vznikl z poptávky „${lead.name}“${castka}.${lead.note ? ` ${lead.note}` : ""}`,
  });

  revalidatePath("/", "layout");
  return { ok: true, clientId: client.id as string };
}
