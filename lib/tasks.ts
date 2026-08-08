import "server-only";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "./supabase/server";
import {
  BALL_ORDER,
  clampStep,
  stepLabel,
  type Ball,
  type TaskKind,
} from "./domain";

/** Řádek z pohledu `tasks_view` — stav i popisky počítá databáze. */
export type TaskRow = {
  id: string;
  title: string;
  note: string | null;
  kind: TaskKind;
  step: number;
  size: number;
  due_at: string | null;
  agreed_at: string | null;
  agreed_note: string | null;
  ball: Ball;
  step_name: string;
  step_count: number;
  is_late: boolean;
  client_id: string | null;
  client_name: string | null;
  client_color: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  assignee_initials: string | null;
};

export type Client = { id: string; name: string; color: string };
export type Category = { id: string; name: string; color: string };

/**
 * Sloupce, které z pohledu čteme. Bez vygenerovaných typů databáze si je
 * supabase-js neumí odvodit, takže výsledek přetypováváme ručně — proto je
 * seznam na jednom místě a `TaskRow` mu odpovídá jedna ku jedné.
 */
const TASK_COLUMNS = [
  "id", "title", "note", "kind", "step", "size",
  "due_at", "agreed_at", "agreed_note",
  "ball", "step_name", "step_count", "is_late",
  "client_id", "client_name", "client_color",
  "supplier_id", "supplier_name", "assignee_initials",
].join(",");

export async function listTasks(orgId: string): Promise<TaskRow[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("tasks_view")
    .select(TASK_COLUMNS)
    .eq("org_id", orgId)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as TaskRow[];
}

export async function listClients(orgId: string): Promise<Client[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("clients")
    .select("id, name, color")
    .eq("org_id", orgId)
    .eq("archived", false)
    .order("name");
  return (data ?? []) as Client[];
}

export async function listCategories(orgId: string): Promise<Category[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("categories")
    .select("id, name, color")
    .eq("org_id", orgId)
    .order("position");
  return (data ?? []) as Category[];
}

/** Rozdělení podle toho, u koho leží míč — v pořadí, v jakém se zobrazuje. */
export function groupByBall(tasks: TaskRow[]): { ball: Ball; tasks: TaskRow[] }[] {
  return BALL_ORDER.map((ball) => ({
    ball,
    tasks: tasks.filter((t) => t.ball === ball),
  })).filter((g) => g.tasks.length > 0);
}

export function countByBall(tasks: TaskRow[]): Record<Ball | "all" | "late", number> {
  const out = { all: tasks.length, me: 0, client: 0, supplier: 0, done: 0, late: 0 };
  for (const t of tasks) {
    out[t.ball] += 1;
    if (t.is_late) out.late += 1;
  }
  return out;
}

/* ================================================================== */
/* Serverové akce                                                      */
/* ================================================================== */

export type ActionResult = { ok: true } | { ok: false; message: string };

/**
 * Posun úkolu na jiný krok.
 *
 * Historii i razítko uzavření dopisuje spouštěč v databázi — aplikace to
 * nedělá, aby se na to nedalo zapomenout a aby to platilo i pro změny
 * provedené odjinud.
 */
export async function moveTask(
  taskId: string,
  toStep: number,
): Promise<ActionResult> {
  const supabase = await supabaseServer();

  const { data: current, error: readErr } = await supabase
    .from("tasks")
    .select("kind")
    .eq("id", taskId)
    .single();

  if (readErr || !current) {
    return { ok: false, message: readErr?.message ?? "Úkol se nenašel." };
  }

  const step = clampStep(current.kind as TaskKind, toStep);

  const { error } = await supabase.from("tasks").update({ step }).eq("id", taskId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setTaskSize(taskId: string, size: number): Promise<ActionResult> {
  const clamped = Math.min(Math.max(Math.trunc(size), 1), 3);
  const supabase = await supabaseServer();
  const { error } = await supabase.from("tasks").update({ size: clamped }).eq("id", taskId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export type NewTask = {
  orgId: string;
  title: string;
  kind: TaskKind;
  step?: number;
  size?: number;
  clientId?: string | null;
  categoryId?: string | null;
  supplierId?: string | null;
  dueAt?: string | null;
  note?: string | null;
};

export async function createTask(input: NewTask): Promise<ActionResult> {
  const title = input.title.trim();
  if (!title) return { ok: false, message: "Úkol potřebuje název." };

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase.from("tasks").insert({
    org_id: input.orgId,
    title,
    kind: input.kind,
    step: clampStep(input.kind, input.step ?? 0),
    size: Math.min(Math.max(Math.trunc(input.size ?? 2), 1), 3),
    client_id: input.clientId ?? null,
    category_id: input.categoryId ?? null,
    supplier_id: input.supplierId ?? null,
    due_at: input.dueAt ?? null,
    note: input.note ?? null,
    created_by: user?.id ?? null,
    assignee_id: user?.id ?? null,
  });

  if (error) return { ok: false, message: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Popisek dalšího kroku — pro tlačítko „Posunout na…“. */
export function nextStepLabel(kind: TaskKind, step: number): string | null {
  const next = step + 1;
  return next < stepCountOf(kind) ? stepLabel(kind, next) : null;
}

function stepCountOf(kind: TaskKind): number {
  return kind === "interni" ? 3 : kind === "klient" ? 4 : 6;
}
