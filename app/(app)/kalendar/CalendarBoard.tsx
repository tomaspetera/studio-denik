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
import type { CalendarEvent } from "@/lib/calendar";
import { setTaskDueDateAction } from "../ukoly/actions";
import styles from "./calendar.module.css";

const KIND_LABEL = { due: "Termín", agreed: "Domluveno", print: "Slíbeno tiskárnou" } as const;
const KIND_ORDER = { due: 0, agreed: 1, print: 2 } as const;

/**
 * Měsíční mřížka jako v Google Kalendáři — celý měsíc, všech šest týdnů
 * včetně přesahu z okolních měsíců. Den se otevře na klik (seznam toho dne
 * + rychlé přidání úkolu), termín (kroužek typu „due“) jde přetáhnout na
 * jiný den přímo v mřížce.
 *
 * Domluva s klientem a slib tiskárny se nepřesouvají odsud — to jsou
 * hodnoty zapsané u úkolu, ne termín, a jejich úprava patří do Úkolů/Tisku.
 */
export default function CalendarBoard({
  events,
  today,
  calendarToken,
  siteUrl,
}: {
  events: CalendarEvent[];
  today: DateKey;
  calendarToken: string | null;
  siteUrl: string;
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
          <p className={styles.sub}>Termíny, domluvy s klienty a sliby tiskárny na jednom místě.</p>
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
                    className={`${styles.item} o-${ev.isLate ? "alarm" : ev.ball}`}
                    draggable={ev.kind === "due"}
                    onDragStart={(e) => {
                      e.stopPropagation();
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
        <span><i className="o-alarm" />Po termínu</span>
        <span className={styles.legendHint}>Termín (plná barva) jde přetáhnout na jiný den.</span>
      </p>

      {selectedDay && (
        <DaySheet
          dateKey={selectedDay}
          events={(byDay.get(selectedDay) ?? []).slice().sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])}
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
  onClose,
}: {
  dateKey: DateKey;
  events: CalendarEvent[];
  onClose: () => void;
}) {
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

        <div className={styles.sheetBody}>
          {events.length === 0 ? (
            <p className={styles.sheetEmpty}>Na tenhle den zatím nic není.</p>
          ) : (
            <ul className={styles.sheetList}>
              {events.map((ev) => (
                <li key={ev.id}>
                  <Link href={`/ukoly?otevrit=${ev.taskId}`} className={styles.sheetItem}>
                    <span className={`${styles.sheetDot} o-${ev.isLate ? "alarm" : ev.ball}`} aria-hidden="true" />
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
                    <span className={`pill o-${ev.isLate ? "alarm" : ev.ball}`}>
                      {ev.isLate ? "po termínu" : BALL_LABEL[ev.ball]}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
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
            Termíny, domluvy s klienty a sliby tiskárny se objeví přímo
            v kalendáři telefonu — v Googlu i na iPhonu. Odkaz je neveřejný:
            funguje stejně jako schvalovací odkaz klienta, kdo ho má, ten
            termíny vidí.
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
