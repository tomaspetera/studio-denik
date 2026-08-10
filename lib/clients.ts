import "server-only";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "./supabase/server";
import type { Ball } from "./domain";

export type ClientRow = {
  id: string;
  name: string;
  color: string;
  contact: string | null;
  email: string | null;
  note: string | null;
  ico: string | null;
  dic: string | null;
  address: string | null;
  archived: boolean;
  share_token: string;
  /** Dopočítané z úkolů — neukládá se. */
  active: number;
  closed: number;
  ball: Ball | null;
  nextDue: string | null;
  late: number;
};

export async function listClientsWithStats(orgId: string): Promise<ClientRow[]> {
  const supabase = await supabaseServer();

  const [{ data: clients }, { data: tasks }] = await Promise.all([
    // Archivované načítáme taky — obrazovka je schová, ale musí je umět
    // ukázat, jinak by nešly vrátit zpátky.
    supabase
      .from("clients")
      .select("id, name, color, contact, email, note, ico, dic, address, archived, share_token")
      .eq("org_id", orgId)
      .order("archived")
      .order("name"),
    supabase
      .from("tasks_view")
      .select("client_id, ball, due_at, is_late")
      .eq("org_id", orgId),
  ]);

  const rows = (clients ?? []) as unknown as Omit<
    ClientRow,
    "active" | "closed" | "ball" | "nextDue" | "late"
  >[];
  const all = (tasks ?? []) as { client_id: string | null; ball: Ball; due_at: string | null; is_late: boolean }[];

  return rows.map((c) => {
    const mine = all.filter((t) => t.client_id === c.id);
    const open = mine.filter((t) => t.ball !== "done");

    // Míč klienta je ten nejnaléhavější ze všech jeho otevřených úkolů.
    // Pořadí naléhavosti: co je na nás, pak u klienta, pak u dodavatele.
    const ball: Ball | null =
      open.length === 0
        ? null
        : open.some((t) => t.ball === "me")
          ? "me"
          : open.some((t) => t.ball === "client")
            ? "client"
            : "supplier";

    const dueDates = open
      .map((t) => t.due_at)
      .filter((d): d is string => Boolean(d))
      .sort();

    return {
      ...c,
      active: open.length,
      closed: mine.length - open.length,
      ball,
      nextDue: dueDates[0] ?? null,
      late: open.filter((t) => t.is_late).length,
    };
  });
}

export type ActionResult = { ok: true } | { ok: false; message: string };

export async function createClient(input: {
  orgId: string;
  name: string;
  color: string;
  contact?: string | null;
  email?: string | null;
  note?: string | null;
  ico?: string | null;
  dic?: string | null;
  address?: string | null;
}): Promise<ActionResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "Klient potřebuje jméno." };

  const supabase = await supabaseServer();
  const { error } = await supabase.from("clients").insert({
    org_id: input.orgId,
    name,
    color: input.color,
    contact: input.contact?.trim() || null,
    email: input.email?.trim() || null,
    note: input.note?.trim() || null,
    ico: input.ico?.replace(/\D/g, "") || null,
    dic: input.dic?.trim().toUpperCase() || null,
    address: input.address?.trim() || null,
  });

  if (error) {
    // Jednoznačný index na (org_id, ico) u neaarchivovaných klientů.
    if (error.code === "23505") {
      return { ok: false, message: "Klient s tímhle IČO už v seznamu je." };
    }
    return { ok: false, message: error.message };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Archivace — pro klienta, se kterým se přestalo spolupracovat.
 *
 * Zmizí ze seznamů i z nabídky u úkolů, ale jeho úkoly si na něj dál pamatují.
 * Staré reporty tak zůstanou celé.
 */
export async function archiveClient(clientId: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("clients")
    .update({ archived: true })
    .eq("id", clientId);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function unarchiveClient(clientId: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("clients")
    .update({ archived: false })
    .eq("id", clientId);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Smazání — pro klienta zadaného omylem.
 *
 * Úkoly se nemažou: vazba na klienta je v databázi nastavená tak, že se
 * při smazání jen uvolní. Úkol tedy zůstane, jen přestane vědět, komu patřil,
 * a v reportu se přesune mezi interní. Publikovaných reportů se to netýká —
 * ty mají uložený vlastní snímek.
 */
export async function deleteClient(clientId: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("clients").delete().eq("id", clientId);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}
