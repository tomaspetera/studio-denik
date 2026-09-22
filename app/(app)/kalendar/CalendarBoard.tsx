"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BALL_LABEL,
  CS_MONTHS_FULL,
  CS_WEEKDAYS_SHORT,
  csDateFromKey,
  monthGridKeys,
  type DateKey,
} from "@/lib/domain";
import type { CalendarEvent, CalendarTone } from "@/lib/calendar";
import type { Client } from "@/lib/tasks";
import {
  setTaskDueDateAction,
  createReminderAction,
  updateReminderAction,
  setReminderDoneAction,
  deleteReminderAction,
} from "./actions";
import styles from "./calendar.module.css";

const KIND_LABEL = {
  due: "Termín",
  agreed: "Domluveno",
  print: "Slíbeno tiskárnou",
  reminder: "Připomínka",
  absence: "Nepřítomnost",
} as const;
const KIND_ORDER = { due: 0, reminder: 1, agreed: 2, print: 3, absence: 4 } as const;

function toneLabel(tone: CalendarTone): string {
  if (tone === "alarm") return "po termínu";
  if (tone === "note") return "Připomínka";
  if (tone === "flat") return "Nepřítomnost";
  return BALL_LABEL[tone];
}

/**
 * Měsíční mřížka jako v Google Kalendáři — celý měsíc, všech šest týdnů
 * včetně přesahu z okolních měsíců. Den se otevře na klik (seznam toho dne
 * + rychlé přidání úkolu nebo připomínky), termín (kroužek typu „due“) jde
 * přetáhnout na jiný den přímo v mřížce.
 *
 * Připomínka je oproti úkolu úmyslně chudší — jen text, volitelná poznámka,
 * volitelný klient a hotovo/nehotovo. Nemá kroky ani míč, protože ne
 * všechno, co si člověk potřebuje poznamenat, je "úkol se štafetou".
 *
 * Domluva s klientem a slib tiskárny se odsud nepřesouvají ani needitují —
 * to jsou hodnoty zapsané u úkolu, jejich úprava patří do Úkolů/Tisku.
 */
export default function CalendarBoard({
  events,
  today,
  calendarToken,
  siteUrl,
  clients,
}: {
  events: CalendarEvent[];
  today: DateKey;
  calendarToken: string | null;
  siteUrl: string;
  clients: Client[];
}) {
  const router = useRouter();
  const [todayY, todayM] = today.split("-").map(Number);
  const [viewYear, setViewYear] = useState(todayY);
  const [viewMonth, setViewMonth] = useState(todayM - 1);
  const [selectedDay, setSelectedDay] = useState<DateKey | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dragOverDay, setDragOverDay] = useState<DateKey | null>(null);
  const [pending, startTransition] = useTransition();
  const [showSubscribe, setShowSubscribe] = useState(false);

  const byDay = useMemo(() => {
    const map = new Map<DateKey, CalendarEvent[]>();
    for (const ev of events) {
      const list = map.get(ev.dateKey) ?? [];
      list.push(ev);
      map.set(ev.dateKey, list);
    }
    return map;
  }, [events]);

  const grid = useMemo(() => monthGridKeys(viewYear, viewMonth), [viewYear, viewMonth]);

  function shiftMonth(delta: number) {
    let y = viewYear;
    let m = viewMonth + delta;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setViewYear(y);
    setViewMonth(m);
  }

  function goToday() {
    setViewYear(todayY);
    setViewMonth(todayM - 1);
  }

  function moveTask(taskId: string, toKey: DateKey) {
    startTransition(async () => {
      // `due_at` je půlnoc UTC toho dne — stejná dohoda jako v Composeru,
      // aby se přetažením v kalendáři nezavlekla stejná chyba, jakou tu
      // dřív dělalo srovnávání okamžiků místo dní.
      await setTaskDueDateAction(taskId, `${toKey}T00:00:00.000Z`);
      router.refresh();
    });
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.h1}>Kalendář</h1>
          <p className={styles.sub}>Termíny, domluvy, sliby tiskárny a připomínky na jednom místě.</p>
        </div>
        <div className={styles.headActs}>
          <button type="button" className="btn" onClick={() => setShowSubscribe(true)}>
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
            <span>Přidat do telefonu</span>
          </button>
          <Link href="/ukoly?zapsat=1" className="btn btn-primary">
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
            <span>Zapsat</span>
          </Link>
        </div>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.nav}>
          <button type="button" className="btn btn-sm" onClick={() => shiftMonth(-1)} aria-label="Předchozí měsíc">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <button type="button" className={styles.monthBtn} onClick={() => setPickerOpen((v) => !v)}>
            {CS_MONTHS_FULL[viewMonth]} {viewYear}
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          <button type="button" className="btn btn-sm" onClick={() => shiftMonth(1)} aria-label="Následující měsíc">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </div>
        <button type="button" className="btn btn-sm" onClick={goToday}>Dnes</button>
      </div>

      {pickerOpen && (
        <YearMonthPicker
          year={viewYear}
          month={viewMonth}
          onPick={(y, m) => { setViewYear(y); setViewMonth(m); setPickerOpen(false); }}
        />
      )}

      <div className={styles.weekHead}>
        {CS_WEEKDAYS_SHORT.map((w) => <span key={w}>{w}</span>)}
      </div>

      <div className={`${styles.grid} ${pending ? styles.busy : ""}`}>
        {grid.map((key) => {
          const inMonth = Number(key.slice(5, 7)) === viewMonth + 1;
          const dayEvents = (byDay.get(key) ?? []).slice().sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
          const isToday = key === today;
          const dayNum = Number(key.slice(8, 10));

          return (
            <button
              type="button"
              key={key}
              className={[
                styles.cell,
                inMonth ? "" : styles.cellOut,
                isToday ? styles.cellToday : "",
                dragOverDay === key ? styles.cellDrop : "",
              ].join(" ")}
              onClick={() => setSelectedDay(key)}
              onDragOver={(e) => { e.preventDefault(); setDragOverDay(key); }}
              onDragLeave={() => setDragOverDay((d) => (d === key ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverDay(null);
                const taskId = e.dataTransfer.getData("text/task-id");
                if (taskId) moveTask(taskId, key);
              }}
            >
              <span className={styles.cellNum}>{dayNum}</span>
              <span className={styles.items}>
                {dayEvents.slice(0, 3).map((ev) => (
                  <span
                    key={ev.id}
                    className={`${styles.item} o-${ev.tone} ${ev.done ? styles.itemDone : ""}`}
                    draggable={ev.kind === "due"}
                    onDragStart={(e) => {
                      e.stopPropagation();
                      if (!ev.taskId) return;
                      e.dataTransfer.setData("text/task-id", ev.taskId);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    title={ev.kind === "due" ? `${ev.title} — přetažením změníš termín` : ev.title}
                  >
                    {ev.title}
                  </span>
                ))}
                {dayEvents.length > 3 && <span className={styles.more}>+{dayEvents.length - 3} další</span>}
              </span>
            </button>
          );
        })}
      </div>

      <p className={styles.legend}>
        <span><i className="o-me" />Na tobě</span>
        <span><i className="o-client" />U klienta</span>
        <span><i className="o-supplier" />U dodavatele</span>
        <span><i className="o-note" />Připomínka</span>
        <span><i className="o-flat" />Nepřítomnost</span>
        <span><i className="o-alarm" />Po termínu</span>
        <span className={styles.legendHint}>Termín (plná barva) jde přetáhnout na jiný den.</span>
      </p>

      {selectedDay && (
        <DaySheet
          dateKey={selectedDay}
          events={(byDay.get(selectedDay) ?? []).slice().sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])}
          clients={clients}
          onClose={() => setSelectedDay(null)}
        />
      )}

      {showSubscribe && (
        <SubscribeSheet token={calendarToken} siteUrl={siteUrl} onClose={() => setShowSubscribe(false)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function DaySheet({
  dateKey,
  events,
  clients,
  onClose,
}: {
  dateKey: DateKey;
  events: CalendarEvent[];
  clients: Client[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    startTransition(() => router.refresh());
  }

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={csDateFromKey(dateKey)}>
        <header className={styles.sheetHead}>
          <h2>{csDateFromKey(dateKey)}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Zavřít">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div className={`${styles.sheetBody} ${pending ? styles.busy : ""}`}>
          {error && <p className={styles.error} role="alert">{error}</p>}

          {events.length === 0 && !adding ? (
            <p className={styles.sheetEmpty}>Na tenhle den zatím nic není.</p>
          ) : (
            <ul className={styles.sheetList}>
              {events.map((ev) => {
                if (ev.kind === "reminder") {
                  return (
                    <ReminderItem
                      key={ev.id}
                      event={ev}
                      clients={clients}
                      onError={setError}
                      onChanged={refresh}
                    />
                  );
                }
                // Nepřítomnost nemá úkol, na který by se dalo skočit — ani
                // ji odsud nejde upravit, to patří na stránku Tým.
                if (ev.kind === "absence") {
                  return (
                    <li key={ev.id} className={styles.sheetItem}>
                      <span className={`${styles.sheetDot} o-${ev.tone}`} aria-hidden="true" />
                      <span className={styles.sheetMain}>
                        <span className={styles.sheetKind}>{KIND_LABEL[ev.kind]}</span>
                        <span className={styles.sheetTitle}>{ev.title}</span>
                        {ev.note && <span className={styles.sheetClient}>{ev.note}</span>}
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={ev.id}>
                    <Link href={`/ukoly?otevrit=${ev.taskId}`} className={styles.sheetItem}>
                      <span className={`${styles.sheetDot} o-${ev.tone}`} aria-hidden="true" />
                      <span className={styles.sheetMain}>
                        <span className={styles.sheetKind}>{KIND_LABEL[ev.kind]}</span>
                        <span className={styles.sheetTitle}>{ev.title}</span>
                        {ev.clientName && (
                          <span className={styles.sheetClient}>
                            <i style={{ background: ev.clientColor ?? "var(--muted)" }} />
                            {ev.clientName}
                          </span>
                        )}
                      </span>
                      <span className={`pill o-${ev.tone}`}>{toneLabel(ev.tone)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {adding ? (
            <ReminderComposer
              dateKey={dateKey}
              clients={clients}
              onError={setError}
              onDone={() => { setAdding(false); refresh(); }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button type="button" className={`btn ${styles.addReminderBtn}`} onClick={() => { setAdding(true); setError(null); }}>
              <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
              <span>Připomínka</span>
            </button>
          )}
        </div>

        <footer className={styles.sheetFoot}>
          <Link href={`/ukoly?zapsat=1&datum=${dateKey}`} className="btn btn-primary">
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
            <span>Přidat úkol na tento den</span>
          </Link>
        </footer>
      </div>
    </div>
  );
}

/** Řádek existující připomínky — odškrtnutí, úprava na místě, smazání. */
function ReminderItem({
  event,
  clients,
  onError,
  onChanged,
}: {
  event: CalendarEvent;
  clients: Client[];
  onError: (m: string | null) => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    onError(null);
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) onError(res.message ?? "Nepodařilo se to.");
    else onChanged();
  }

  if (editing) {
    return (
      <li>
        <ReminderComposer
          dateKey={event.dateKey}
          clients={clients}
          initial={{ id: event.reminderId!, title: event.title, note: event.note, clientId: event.clientId }}
          onError={onError}
          onDone={() => { setEditing(false); onChanged(); }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li>
      <div className={`${styles.sheetItem} ${styles.sheetReminder} o-note`}>
        <button
          type="button"
          className={`${styles.checkbox} ${event.done ? styles.checkboxOn : ""}`}
          disabled={busy}
          aria-label={event.done ? "Označit jako nesplněné" : "Označit jako splněné"}
          onClick={() => run(() => setReminderDoneAction(event.reminderId!, !event.done))}
        >
          {event.done && (
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12l6 6L20 6" />
            </svg>
          )}
        </button>

        <button type="button" className={styles.sheetMain} onClick={() => setEditing(true)} title="Upravit">
          <span className={styles.sheetKind}>Připomínka{event.stepName ? ` · ${event.stepName}` : ""}</span>
          <span className={`${styles.sheetTitle} ${event.done ? styles.sheetTitleDone : ""}`}>{event.title}</span>
          {event.note && <span className={styles.sheetNote}>{event.note}</span>}
          {event.clientName && (
            <span className={styles.sheetClient}>
              <i style={{ background: event.clientColor ?? "var(--muted)" }} />
              {event.clientName}
            </span>
          )}
        </button>

        <button
          type="button"
          className={styles.sheetDelete}
          disabled={busy}
          aria-label="Smazat připomínku"
          onClick={() => run(() => deleteReminderAction(event.reminderId!))}
        >
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </li>
  );
}

/** Formulář pro novou i upravovanou připomínku — stejné pole v obou případech. */
function ReminderComposer({
  dateKey,
  clients,
  initial,
  onError,
  onDone,
  onCancel,
}: {
  dateKey: DateKey;
  clients: Client[];
  initial?: { id: string; title: string; note: string | null; clientId: string | null };
  onError: (m: string | null) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [clientId, setClientId] = useState(initial?.clientId ?? "");
  const [showNote, setShowNote] = useState(Boolean(initial?.note));
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!title.trim()) return;
    onError(null);
    setSaving(true);
    const res = initial
      ? await updateReminderAction({ id: initial.id, title, note, clientId: clientId || null })
      : await createReminderAction({ title, note, date: dateKey, clientId: clientId || null });
    setSaving(false);
    if (!res.ok) onError(res.message ?? "Nepodařilo se to.");
    else onDone();
  }

  return (
    <div className={styles.reminderForm}>
      <input
        className="field"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Zavolat klientovi kvůli…"
        autoFocus
        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && save()}
      />

      {showNote ? (
        <textarea
          className="field"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Poznámka navíc (nepovinné)…"
        />
      ) : (
        <button type="button" className={styles.linkBtn} onClick={() => setShowNote(true)}>+ poznámka</button>
      )}

      {clients.length > 0 && (
        <select className="field" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">— bez klienta —</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}

      <div className={styles.reminderFormActs}>
        <button type="button" className="btn btn-primary btn-sm" disabled={saving || !title.trim()} onClick={save}>
          {saving ? "Ukládám…" : "Uložit"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Zrušit</button>
      </div>
    </div>
  );
}

function YearMonthPicker({
  year,
  month,
  onPick,
}: {
  year: number;
  month: number;
  onPick: (year: number, month: number) => void;
}) {
  const [y, setY] = useState(year);
  return (
    <div className={styles.picker}>
      <div className={styles.pickerYear}>
        <button type="button" className="btn btn-sm" onClick={() => setY((v) => v - 1)} aria-label="Předchozí rok">‹</button>
        <b>{y}</b>
        <button type="button" className="btn btn-sm" onClick={() => setY((v) => v + 1)} aria-label="Následující rok">›</button>
      </div>
      <div className={styles.pickerMonths}>
        {CS_MONTHS_FULL.map((name, i) => (
          <button
            key={name}
            type="button"
            className={`${styles.pickerMonth} ${y === year && i === month ? styles.pickerMonthOn : ""}`}
            onClick={() => onPick(y, i)}
          >
            {name.slice(0, 3)}
          </button>
        ))}
      </div>
    </div>
  );
}

function SubscribeSheet({
  token,
  siteUrl,
  onClose,
}: {
  token: string | null;
  siteUrl: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const url = token
    ? `${siteUrl || (typeof window !== "undefined" ? window.location.origin : "")}/api/kalendar/${token}`
    : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label="Kalendář v telefonu">
        <header className={styles.sheetHead}>
          <h2>Kalendář v telefonu</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Zavřít">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div className={styles.sheetBody}>
          <p className={styles.note}>
            Termíny, domluvy s klienty, sliby tiskárny i připomínky se objeví
            přímo v kalendáři telefonu — v Googlu i na iPhonu. Odkaz je
            neveřejný: funguje stejně jako schvalovací odkaz klienta, kdo ho
            má, ten termíny vidí.
          </p>

          {token ? (
            <>
              <span className={styles.label}>Adresa pro přidání kalendáře</span>
              <div className={styles.urlRow}>
                <code className={styles.urlBox}>{url}</code>
                <button type="button" className="btn btn-sm" onClick={copy}>
                  {copied ? "Zkopírováno" : "Kopírovat"}
                </button>
              </div>

              <ol className={styles.steps}>
                <li><b>Google Kalendář</b> (v prohlížeči, ne v mobilní appce): vlevo dole „Další kalendáře“ → „Ze URL adresy“ → vlož odkaz.</li>
                <li><b>iPhone / Apple Kalendář</b>: Nastavení → Aplikace → Kalendář → Účty → Přidat účet → Jiné → Přidat odebíraný kalendář → vlož odkaz.</li>
              </ol>

              <p className={styles.hintSmall}>
                Google u odebíraných kalendářů bohužel ignoruje vestavěné
                připomínky a stahuje nové termíny jen několikrát denně —
                spolehlivé upozornění přímo z telefonu přinese až notifikace
                z aplikace samotné.
              </p>
            </>
          ) : (
            <p className={styles.error}>Kalendáři chybí token. Zkus stránku načíst znovu.</p>
          )}
        </div>
      </div>
    </div>
  );
}
