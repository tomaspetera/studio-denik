import "server-only";

import { supabaseServer } from "./supabase/server";
import { dateKeyUTC, type Ball, type DateKey } from "./domain";
import { listReminders } from "./reminders";

/**
 * Kalendář uvnitř aplikace čte přímo `tasks_view`, `print_jobs`
 * a `reminders_view` — přístupová práva na nich už existují, takže sem
 * netřeba vytvářet novou cestu k datům. Veřejný odběr do telefonu (níž)
 * je jiný případ: tam se ptá cizí kalendářová appka bez přihlášení, a pro
 * to slouží `public_calendar_feed` z migrace 0008/0009.
 *
 * `tone` sjednocuje barvu bez ohledu na typ události — u termínu úkolu je
 * to "u koho leží míč" (případně po termínu), u připomínky vlastní odstín
 * "note", který s míčem nemá co dělat.
 */
/** Barevný tón položky. "alarm" a "note" nejsou stavy míče, jen vlastní odstíny navíc. */
export type CalendarTone = Ball | "alarm" | "note";

export type CalendarEvent = {
  id: string;
  /** `null` u připomínky — ta žádný úkol nemá. */
  taskId: string | null;
  /** `null` u všeho, co pochází z úkolu. */
  reminderId: string | null;
  dateKey: DateKey;
  kind: "due" | "agreed" | "print" | "reminder";
  title: string;
  note: string | null;
  /** Jen u připomínky se dá v kalendáři měnit — u úkolu se klient mění v Úkolech. */
  clientId: string | null;
  clientName: string | null;
  clientColor: string | null;
  tone: CalendarTone;
  stepName: string | null;
  done: boolean;
};

/** Token pro odběr do telefonu. Existuje od migrace 0008 u každé organizace. */
export async function getCalendarToken(orgId: string): Promise<string | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("orgs").select("calendar_token").eq("id", orgId).single();
  return (data?.calendar_token as string | undefined) ?? null;
}

export async function listCalendarEvents(orgId: string): Promise<CalendarEvent[]> {
  const supabase = await supabaseServer();

  const [{ data: tasks }, { data: jobs }, reminders] = await Promise.all([
    supabase
      .from("tasks_view")
      .select("id,title,due_at,agreed_at,agreed_note,ball,is_late,client_name,client_color,step_name")
      .eq("org_id", orgId),
    supabase
      .from("print_jobs")
      .select("task_id,promised_at,delivered_at")
      .eq("org_id", orgId),
    listReminders(orgId),
  ]);

  const rows = (tasks ?? []) as unknown as {
    id: string; title: string; due_at: string | null; agreed_at: string | null;
    agreed_note: string | null; ball: Ball; is_late: boolean;
    client_name: string | null; client_color: string | null; step_name: string;
  }[];
  const jobsByTask = new Map(
    (jobs ?? [])
      .filter((j) => j.promised_at && !j.delivered_at)
      .map((j) => [j.task_id as string, j.promised_at as string]),
  );

  const events: CalendarEvent[] = [];

  for (const t of rows) {
    if (t.due_at) {
      events.push({
        id: `due-${t.id}`,
        taskId: t.id,
        reminderId: null,
        dateKey: dateKeyUTC(t.due_at),
        kind: "due",
        title: t.title,
        note: null,
        clientId: null,
        clientName: t.client_name,
        clientColor: t.client_color,
        // `is_late` je z definice `is_task_late` vždy false pro hotové
        // úkoly (migrace 0008), takže tahle větev nikdy nezakryje "done".
        tone: t.is_late ? "alarm" : t.ball,
        stepName: t.step_name,
        done: t.ball === "done",
      });
    }
    if (t.agreed_at) {
      events.push({
        id: `agreed-${t.id}`,
        taskId: t.id,
        reminderId: null,
        dateKey: dateKeyUTC(t.agreed_at),
        kind: "agreed",
        title: t.agreed_note ? `${t.title} — ${t.agreed_note}` : t.title,
        note: null,
        clientId: null,
        clientName: t.client_name,
        clientColor: t.client_color,
        tone: t.ball,
        stepName: t.step_name,
        done: t.ball === "done",
      });
    }
    const promised = jobsByTask.get(t.id);
    if (promised) {
      events.push({
        id: `print-${t.id}`,
        taskId: t.id,
        reminderId: null,
        dateKey: dateKeyUTC(promised),
        kind: "print",
        title: t.title,
        note: null,
        clientId: null,
        clientName: t.client_name,
        clientColor: t.client_color,
        tone: t.is_late ? "alarm" : t.ball,
        stepName: t.step_name,
        done: t.ball === "done",
      });
    }
  }

  for (const r of reminders) {
    events.push({
      id: `reminder-${r.id}`,
      taskId: null,
      reminderId: r.id,
      dateKey: r.date,
      kind: "reminder",
      title: r.title,
      note: r.note,
      clientId: r.clientId,
      clientName: r.clientName,
      clientColor: r.clientColor,
      tone: "note",
      stepName: r.createdByInitials ? `zapsal ${r.createdByInitials}` : null,
      done: r.done,
    });
  }

  return events;
}

/* ================================================================== */
/* Veřejný odběr do telefonu (Google/Apple Kalendář)                    */
/* ================================================================== */

type FeedEvent = {
  uid: string;
  date: string;
  title: string;
  client: string | null;
  kind: "due" | "agreed" | "print" | "reminder";
};

const KIND_PREFIX: Record<FeedEvent["kind"], string> = {
  due: "Termín",
  agreed: "Domluveno",
  print: "Slíbeno tiskárnou",
  reminder: "Připomínka",
};

export async function loadCalendarFeedIcs(token: string): Promise<string | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("public_calendar_feed", { p_token: token });
  if (error || !data) return null;

  const feed = data as { org_name: string; events: FeedEvent[] };
  return toIcs(feed.org_name, feed.events);
}

/**
 * Sestaví ICS text ručně — formát je jednoduchý a knihovna navíc by ho
 * jen zabalila do závislosti. Datum je celý den (`VALUE=DATE`), ne hodina:
 * termíny se v aplikaci zadávají na den, ne na čas.
 */
function toIcs(orgName: string, events: FeedEvent[]): string {
  const stamp = icsStamp(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Studio Denik//Kalendar//CS",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcs(orgName)} — termíny`,
    "X-WR-TIMEZONE:Europe/Prague",
  ];

  for (const ev of events) {
    if (!ev.date) continue;
    const day = dateKeyUTC(ev.date).replace(/-/g, "");
    const summary = `${KIND_PREFIX[ev.kind]}: ${ev.title}${ev.client ? ` (${ev.client})` : ""}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.uid}@studio-denik`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day}`,
      `SUMMARY:${escapeIcs(summary)}`,
      // Google Kalendář budíky z přihlášeného kalendáře záměrně ignoruje —
      // tenhle alarm se uplatní hlavně v Apple Kalendáři. Skutečně
      // spolehlivé upozornění dá až notifikace přímo z aplikace.
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeIcs(summary)}`,
      "TRIGGER:PT9H",
      "END:VALARM",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function escapeIcs(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
