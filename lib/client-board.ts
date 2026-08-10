import "server-only";

import { supabaseServer } from "./supabase/server";
import type { Ball } from "./domain";

/**
 * Schvalovací odkaz klienta.
 *
 * Klient nemá účet a mít ho nebude — jediné, čím se prokazuje, je token
 * v adrese. Čtení i zápis proto jdou přes funkce v databázi, které si samy
 * ověří, že úkol patří právě tomu klientovi a že na něj skutečně čeká.
 * Aplikace tu nic nekontroluje, protože by to bylo druhé místo pravdy
 * a stačilo by ho obejít.
 */

export type ClientTask = {
  id: string;
  title: string;
  step_name: string;
  ball: Ball;
  due_at: string | null;
  agreed_at: string | null;
  agreed_note: string | null;
  reply: string | null;
  reply_at: string | null;
  is_late: boolean;
};

export type ClientBoard = {
  client_name: string;
  client_color: string;
  org_name: string;
  sender: string | null;
  sender_mail: string | null;
  tasks: ClientTask[];
};

export async function loadClientBoard(token: string): Promise<ClientBoard | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("public_client_board", { p_token: token });
  if (error || !data) return null;
  return data as ClientBoard;
}

export type DecideResult =
  | { ok: true; step_name: string; ball: Ball }
  | { ok: false; message: string };

/** Proč to neprošlo. Databáze vrací důvod kódem, tady dostane větu. */
const REASONS: Record<string, string> = {
  link: "Tenhle odkaz už neplatí.",
  task: "Tenhle úkol na odkazu není.",
  step: "Mezitím se s úkolem něco stalo — načti stránku znovu.",
  note: "Napiš prosím, co je potřeba upravit.",
};

export async function clientDecide(input: {
  token: string;
  taskId: string;
  approve: boolean;
  note: string;
}): Promise<DecideResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("client_decide", {
    p_token: input.token,
    p_task: input.taskId,
    p_approve: input.approve,
    p_note: input.note.trim() || null,
  });

  if (error) return { ok: false, message: "Nepodařilo se to odeslat." };

  const res = data as
    | { ok: true; step_name: string; ball: Ball }
    | { ok: false; reason: string };

  if (!res?.ok) {
    return { ok: false, message: REASONS[res?.reason] ?? "Nepodařilo se to odeslat." };
  }
  return { ok: true, step_name: res.step_name, ball: res.ball };
}
