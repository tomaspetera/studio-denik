"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { plural, type DateKey } from "@/lib/domain";
import { shortDateLabel } from "@/lib/buckets";
import { planTarget, type WeekDay, type WeekPlan, type WeekTask } from "@/lib/week";
import { moveTaskAction } from "../ukoly/actions";
import { UndoToast, useUndo } from "../Undo";
import { planTaskAction } from "./actions";
import styles from "./week.module.css";

type Vysledek = { ok: true } | { ok: false; message: string };

/** Kam úkol pustit: den, nebo zpátky mezi nenaplánované. */
type Cil = { key: string | null; label: string };

/**
 * Můj týden — viz `lib/week.ts`. Vlevo je, co ještě nemá svůj den; vpravo dny
 * od dneška do konce týdne. Úkol se na den zařadí přetažením, nebo tlačítkem
 * „Kdy“ (na telefonu se přetahovat nedá). Termín úkolu se tím nemění.
 */
export default function WeekBoard({
  week,
  today,
  prevHref,
  nextHref,
  nextMonday,
}: {
  week: WeekPlan;
  /** Dnešek podle Prahy, počítaný na serveru. */
  today: DateKey;
  prevHref: string;
  nextHref: string;
  /** Pondělí po zobrazeném týdnu — volba „Příští týden“ v nabídce. */
  nextMonday: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** Úkol tažený myší a sloupec, nad kterým zrovna visí ("" = nenaplánováno). */
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const undo = useUndo();

  function uloz(akce: () => Promise<Vysledek>, zpet?: { text: string; akce: () => Promise<Vysledek> }) {
    setError(null);
    undo.hide();
    startTransition(async () => {
      const res = await akce();
      if (!res.ok) setError(res.message);
      else if (zpet) undo.show({ text: zpet.text, run: () => uloz(zpet.akce) });
      router.refresh();
    });
  }

  const naplanuj = (t: WeekTask, den: string | null) => {
    const kam = den === null ? null : planTarget(den, today);
    if (kam === t.plannedKey) return;
    uloz(() => planTaskAction(t.id, kam));
  };

  const hotovo = (t: WeekTask) =>
    uloz(() => moveTaskAction(t.id, t.finish.step), {
      text: `${t.title} → ${t.finish.label}`,
      akce: () => moveTaskAction(t.id, t.step),
    });

  // Uplynulé dny jsou prázdné vždycky — co se nestihlo, je přenesené na dnešek.
  const dny = week.days.filter((d) => !d.isPast);
  const vsechny = [...week.unplanned, ...week.days.flatMap((d) => d.items)];
  const tazeny = dragging ? (vsechny.find((t) => t.id === dragging) ?? null) : null;

  const cile: Cil[] = [
    ...dny.map((d) => ({ key: d.key, label: d.isToday ? `Dnes (${d.label})` : `${d.label} ${d.dateLabel}` })),
    { key: nextMonday, label: `Příští týden (${shortDateLabel(nextMonday)})` },
  ];

  /** Vlastnosti cíle přetažení — stejné pro den i pro „Nenaplánováno“. */
  const cilTazeni = (id: string, den: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!tazeny) return;
      e.preventDefault();
      setOver(id);
    },
    onDragLeave: () => setOver((o) => (o === id ? null : o)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(null);
      if (tazeny) naplanuj(tazeny, den);
      setDragging(null);
    },
  });

  const karta = (t: WeekTask) => (
    <Card
      key={t.id}
      t={t}
      cile={cile}
      disabled={pending}
      dragging={dragging === t.id}
      onDragStart={() => setDragging(t.id)}
      onDragEnd={() => {
        setDragging(null);
        setOver(null);
      }}
      onPlan={(den) => naplanuj(t, den)}
      onDone={() => hotovo(t)}
    />
  );

  const naplanovano = week.days.reduce((n, d) => n + d.items.length, 0);
  // „Další 1 úkol je naplánovaný“, „Další 2 úkoly jsou naplánované“, „Dalších 5 úkolů je naplánovaných“.
  const jinde = `${plural(week.elsewhere, "Další", "Další", "Dalších")} ${week.elsewhere} ${plural(week.elsewhere, "úkol je naplánovaný", "úkoly jsou naplánované", "úkolů je naplánovaných")}`;

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.h1}>Můj týden</h1>
          <p className={styles.sub}>
            {week.rangeLabel} · naplánováno {naplanovano} · nenaplánováno {week.unplanned.length}
          </p>
        </div>
        <div className={styles.tools}>
          <Link href={prevHref} className="btn" aria-label="Předchozí týden" title="Předchozí týden">
            <svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></svg>
          </Link>
          {!week.isCurrent && <Link href="/tyden" className="btn">Tento týden</Link>}
          <Link href={nextHref} className="btn" aria-label="Další týden" title="Další týden">
            <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
          </Link>
        </div>
      </header>

      {error && <p className={styles.error} role="alert">{error}</p>}

      <div className={`${styles.board} ${pending ? styles.busy : ""}`}>
        <section
          className={`panel o-me ${styles.pool} ${over === "" ? styles.over : ""}`}
          aria-label="Nenaplánované úkoly"
          {...cilTazeni("", null)}
        >
          <header className={styles.poolHead}>
            <h2>Nenaplánováno</h2>
            <em>{week.unplanned.length}</em>
          </header>
          {week.unplanned.length > 0 ? (
            <ul className={styles.list}>{week.unplanned.map(karta)}</ul>
          ) : (
            <p className={styles.empty}>Všechno, co je na tobě, má svůj den.</p>
          )}
          {week.elsewhere > 0 && (
            <p className={styles.note}>
              {week.isCurrent
                ? `${jinde} na jiný týden.`
                : `${jinde} na jiný týden — nestihnuté z dřívějška najdeš v tomto týdnu u dneška.`}
            </p>
          )}
        </section>

        <div className={styles.days}>
          {dny.length === 0 && <p className={`panel ${styles.empty}`}>Tenhle týden už uplynul.</p>}
          {dny.map((d: WeekDay) => (
            <section
              key={d.key}
              className={`panel ${styles.day} ${d.isToday ? styles.today : ""} ${over === d.key ? styles.over : ""}`}
              aria-label={`${d.label} ${d.dateLabel}`}
              {...cilTazeni(d.key, d.key)}
            >
              <header className={styles.dayHead}>
                <h2>{d.isToday ? "Dnes" : d.label}</h2>
                <span>{d.isToday ? `${d.label} ${d.dateLabel}` : d.dateLabel}</span>
                {d.items.length > 0 && <em>{d.items.length}</em>}
              </header>
              {d.items.length > 0 ? (
                <ul className={styles.list}>{d.items.map(karta)}</ul>
              ) : (
                <p className={styles.drop}>{tazeny ? "Pusť úkol sem" : "Nic naplánováno"}</p>
              )}
            </section>
          ))}
        </div>
      </div>

      <UndoToast undo={undo} disabled={pending} />
    </div>
  );
}

function Card({
  t,
  cile,
  disabled,
  dragging,
  onDragStart,
  onDragEnd,
  onPlan,
  onDone,
}: {
  t: WeekTask;
  cile: Cil[];
  disabled: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onPlan: (den: string | null) => void;
  onDone: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const barva = t.dueTone === "late" ? styles.dueLate : t.dueTone === "today" ? styles.dueToday : "";

  return (
    <li
      className={`${styles.card} ${dragging ? styles.dragging : ""}`}
      draggable={!disabled}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/task-id", t.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <div className={styles.cardMain}>
        <Link href={`/ukoly?otevrit=${t.id}`} className={styles.cardTitle} draggable={false} title="Otevřít úkol">
          {t.title}
        </Link>
        <span className={styles.cardMeta}>
          {t.clientName && (
            <span className={styles.client} title={t.clientName}>
              <i style={t.clientColor ? { background: t.clientColor } : undefined} />
              {t.clientName}
            </span>
          )}
          <span>{t.stepName}</span>
          {t.dueLabel ? <span className={barva}>termín {t.dueLabel}</span> : <span>bez termínu</span>}
          {t.carried && t.plannedKey && <span className={styles.carried}>přeneseno z {shortDateLabel(t.plannedKey)}</span>}
        </span>
      </div>

      {/* `tabIndex` kvůli prohlížečům, které tlačítku po kliknutí nedají fokus. */}
      <div
        className={styles.cardActs}
        tabIndex={-1}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setMenu(false);
        }}
        onKeyDown={(e) => e.key === "Escape" && setMenu(false)}
      >
        <button
          type="button"
          className={`btn btn-sm ${styles.when}`}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={menu}
          title="Na který den úkol zařadit"
          onClick={() => setMenu(!menu)}
        >
          Kdy
        </button>
        <button
          type="button"
          className={`btn btn-sm btn-ghost ${styles.done}`}
          disabled={disabled}
          title={`Rovnou „${t.finish.label}“`}
          aria-label={`Rovnou ${t.finish.label}: ${t.title}`}
          onClick={onDone}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </button>

        {menu && (
          <div className={styles.menu} role="menu">
            {cile.map((c) => (
              <button
                key={c.key}
                type="button"
                role="menuitemradio"
                aria-checked={c.key === t.plannedKey}
                className={c.key === t.plannedKey ? styles.menuOn : undefined}
                onClick={() => {
                  setMenu(false);
                  onPlan(c.key);
                }}
              >
                {c.label}
              </button>
            ))}
            {t.plannedKey && (
              <button
                type="button"
                role="menuitem"
                className={styles.menuOff}
                onClick={() => {
                  setMenu(false);
                  onPlan(null);
                }}
              >
                Zrušit plán
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
