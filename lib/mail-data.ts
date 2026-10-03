import "server-only";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "./supabase/server";
import { decryptToken, encryptToken } from "./mail-crypto";
import {
  GmailAuthExpired,
  GmailError,
  accessTokenFrom,
  exchangeCode,
  fetchEmailAddress,
  fetchInbox,
  isGmailConfigured,
  revokeToken,
} from "./gmail";
import { triage, type ClientContact, type MailStatus } from "./mail-rules";

/**
 * Pošta — ukládání a čtení.
 *
 * Z Gmailu se ukládají jen hlavičky (odesílatel, předmět, datum) a stav.
 * Těla zpráv ani úryvky nikam nejdou a do žádné AI se neposílá nic.
 */

export type MailAccount = { email: string; lastSyncAt: string | null };

export type MailRow = {
  id: string;
  gmailId: string;
  threadId: string;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  receivedAt: string;
  status: MailStatus;
  clientId: string | null;
  clientName: string | null;
  handledAt: string | null;
  taskId: string | null;
};

export type ActionResult = { ok: true } | { ok: false; message: string };

/** Kolik dní zpětně se pošta stahuje. */
const OKNO_DNI = 7;

function klicProSifrovani(): string {
  const k = process.env.MAIL_TOKEN_KEY;
  if (!k) throw new GmailError("Chybí MAIL_TOKEN_KEY.");
  return k;
}

function chybaText(e: unknown): string {
  if (e instanceof GmailAuthExpired) return e.message;
  if (e instanceof GmailError) return e.message;
  console.error("Pošta selhala:", e);
  return "Nepodařilo se spojit s Gmailem. Zkus to za chvíli znovu.";
}

export { isGmailConfigured };

export async function loadMailAccount(userId: string): Promise<MailAccount | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("mail_accounts")
    .select("email, last_sync_at")
    .eq("user_id", userId)
    .maybeSingle();

  return data ? { email: data.email as string, lastSyncAt: (data.last_sync_at as string | null) ?? null } : null;
}

/**
 * Dokončení připojení: kód z přesměrování se vymění za trvalé přihlášení,
 * které se uloží zašifrované. V čitelné podobě nikde nezůstane.
 */
export async function connectMailbox(orgId: string, userId: string, code: string, origin: string): Promise<ActionResult> {
  try {
    const { refreshToken, accessToken } = await exchangeCode(code, origin);
    const email = await fetchEmailAddress(accessToken);

    const supabase = await supabaseServer();
    const { error } = await supabase.from("mail_accounts").upsert(
      {
        org_id: orgId,
        user_id: userId,
        email,
        token_enc: encryptToken(refreshToken, klicProSifrovani()),
        last_sync_at: null,
      },
      { onConflict: "user_id" },
    );
    if (error) return { ok: false, message: error.message };

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: chybaText(e) };
  }
}

/** Odpojení: zruší přístup u Googlu a smaže uložené přihlášení i staženou poštu. */
export async function disconnectMailbox(userId: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("mail_accounts").select("token_enc").eq("user_id", userId).maybeSingle();

  if (data?.token_enc) {
    try {
      await revokeToken(decryptToken(data.token_enc as string, klicProSifrovani()));
    } catch {
      // I kdyby odvolání u Googlu selhalo, uložené přihlášení mažeme —
      // přístup jde zrušit i ručně v nastavení účtu Google.
    }
  }

  await supabase.from("mail_messages").delete().eq("user_id", userId);
  const { error } = await supabase.from("mail_accounts").delete().eq("user_id", userId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Adresy, podle kterých se pozná, komu zpráva patří: z karty klienta i z kontaktů. */
async function nactiKontakty(orgId: string): Promise<ClientContact[]> {
  const supabase = await supabaseServer();
  const [{ data: klienti }, { data: kontakty }] = await Promise.all([
    supabase.from("clients").select("id, email").eq("org_id", orgId).eq("archived", false),
    supabase.from("client_contacts").select("client_id, email").eq("org_id", orgId),
  ]);

  const podleKlienta = new Map<string, string[]>();
  const pridej = (id: string | null, email: string | null) => {
    if (!id || !email?.trim()) return;
    podleKlienta.set(id, [...(podleKlienta.get(id) ?? []), email.trim()]);
  };

  for (const k of klienti ?? []) pridej(k.id as string, k.email as string | null);
  for (const c of kontakty ?? []) pridej(c.client_id as string, c.email as string | null);

  return [...podleKlienta].map(([clientId, emails]) => ({ clientId, emails }));
}

/**
 * Stažení pošty. Vlákna, která už v doručených nejsou, se z appky smažou —
 * přehled má zrcadlit schránku, ne si držet vlastní historii.
 */
export async function syncMailbox(orgId: string, userId: string): Promise<ActionResult & { count?: number }> {
  const supabase = await supabaseServer();

  const { data: ucet } = await supabase
    .from("mail_accounts")
    .select("email, token_enc")
    .eq("user_id", userId)
    .maybeSingle();
  if (!ucet) return { ok: false, message: "Schránka není připojená." };

  try {
    const accessToken = await accessTokenFrom(decryptToken(ucet.token_enc as string, klicProSifrovani()));
    const syrove = await fetchInbox(accessToken, OKNO_DNI, ucet.email as string);

    const [kontakty, { data: ignorovani }, { data: stavajici }] = await Promise.all([
      nactiKontakty(orgId),
      supabase.from("mail_ignored").select("pattern").eq("user_id", userId),
      supabase.from("mail_messages").select("gmail_id, handled_at, task_id").eq("user_id", userId),
    ]);

    const zpravy = triage(syrove, {
      myEmail: ucet.email as string,
      contacts: kontakty,
      ignored: (ignorovani ?? []).map((i) => i.pattern as string),
    });

    // Ruční zásahy („vyřízeno“, vzniklý úkol) se při obnovení nesmí ztratit.
    const drive = new Map(
      (stavajici ?? []).map((r) => [r.gmail_id as string, { handledAt: r.handled_at as string | null, taskId: r.task_id as string | null }]),
    );

    if (zpravy.length > 0) {
      const { error } = await supabase.from("mail_messages").upsert(
        zpravy.map((z) => ({
          org_id: orgId,
          user_id: userId,
          gmail_id: z.gmailId,
          thread_id: z.threadId,
          from_email: z.fromEmail,
          from_name: z.fromName,
          subject: z.subject,
          received_at: z.receivedAt,
          status: z.status,
          client_id: z.clientId,
          handled_at: drive.get(z.gmailId)?.handledAt ?? null,
          task_id: drive.get(z.gmailId)?.taskId ?? null,
        })),
        { onConflict: "user_id,gmail_id" },
      );
      if (error) return { ok: false, message: error.message };
    }

    const ponechat = new Set(zpravy.map((z) => z.gmailId));
    const kSmazani = [...drive.keys()].filter((id) => !ponechat.has(id));
    if (kSmazani.length > 0) {
      await supabase.from("mail_messages").delete().eq("user_id", userId).in("gmail_id", kSmazani);
    }

    await supabase.from("mail_accounts").update({ last_sync_at: new Date().toISOString() }).eq("user_id", userId);

    revalidatePath("/", "layout");
    return { ok: true, count: zpravy.length };
  } catch (e) {
    return { ok: false, message: chybaText(e) };
  }
}

export async function listMail(userId: string): Promise<MailRow[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("mail_messages")
    .select("id, gmail_id, thread_id, from_email, from_name, subject, received_at, status, client_id, handled_at, task_id, clients(name)")
    .eq("user_id", userId)
    .order("received_at", { ascending: false });

  type Row = {
    id: string; gmail_id: string; thread_id: string; from_email: string; from_name: string | null;
    subject: string | null; received_at: string; status: MailStatus; client_id: string | null;
    handled_at: string | null; task_id: string | null; clients: { name: string } | { name: string }[] | null;
  };

  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    gmailId: r.gmail_id,
    threadId: r.thread_id,
    fromEmail: r.from_email,
    fromName: r.from_name,
    subject: r.subject,
    receivedAt: r.received_at,
    status: r.status,
    clientId: r.client_id,
    clientName: Array.isArray(r.clients) ? (r.clients[0]?.name ?? null) : (r.clients?.name ?? null),
    handledAt: r.handled_at,
    taskId: r.task_id,
  }));
}

export async function setHandled(id: string, handled: boolean): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("mail_messages")
    .update({ handled_at: handled ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: "Zpráva se nenašla." };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Odesílatel, kterého už nechceš vídat. Jeho zprávy se rovnou smažou. */
export async function ignoreSender(orgId: string, userId: string, pattern: string): Promise<ActionResult> {
  const vzorec = pattern.trim().toLowerCase().replace(/^@/, "");
  if (!vzorec) return { ok: false, message: "Chybí adresa nebo doména." };

  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("mail_ignored")
    .upsert({ org_id: orgId, user_id: userId, pattern: vzorec }, { onConflict: "user_id,pattern" });
  if (error) return { ok: false, message: error.message };

  const jeDomena = !vzorec.includes("@");
  const dotaz = supabase.from("mail_messages").delete().eq("user_id", userId);
  await (jeDomena ? dotaz.like("from_email", `%@${vzorec}`) : dotaz.eq("from_email", vzorec));

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Ze zprávy úkol. Příznak „vyřízeno“ se nastaví rovnou — zpráva je tím
 * vyřešená, dál ji hlídá úkol.
 */
export async function taskFromMail(orgId: string, userId: string, mailId: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { data: zprava } = await supabase
    .from("mail_messages")
    .select("subject, from_name, from_email, client_id")
    .eq("id", mailId)
    .maybeSingle();
  if (!zprava) return { ok: false, message: "Zpráva se nenašla." };

  const kdo = (zprava.from_name as string | null)?.trim() || (zprava.from_email as string);
  const predmet = (zprava.subject as string | null)?.trim();
  const nazev = (predmet ? `Odpovědět: ${predmet}` : `Odpovědět: ${kdo}`).slice(0, 200);

  const zaDvaDny = new Date();
  zaDvaDny.setUTCDate(zaDvaDny.getUTCDate() + 2);

  const { data: ukol, error } = await supabase
    .from("tasks")
    .insert({
      org_id: orgId,
      title: nazev,
      // S klientem jen tehdy, když víme s kým; jinak je to interní úkol.
      kind: zprava.client_id ? "klient" : "interni",
      step: 0,
      size: 1,
      client_id: zprava.client_id,
      assignee_id: userId,
      created_by: userId,
      due_at: `${zaDvaDny.toISOString().slice(0, 10)}T00:00:00.000Z`,
    })
    .select("id")
    .single();

  if (error || !ukol) return { ok: false, message: error?.message ?? "Úkol se nepodařilo založit." };

  await supabase
    .from("mail_messages")
    .update({ task_id: ukol.id, handled_at: new Date().toISOString() })
    .eq("id", mailId);

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function listIgnored(userId: string): Promise<{ id: string; pattern: string }[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("mail_ignored").select("id, pattern").eq("user_id", userId).order("pattern");
  return (data ?? []).map((r) => ({ id: r.id as string, pattern: r.pattern as string }));
}

export async function unignore(id: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("mail_ignored").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}
