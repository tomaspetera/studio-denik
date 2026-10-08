"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MailRow } from "@/lib/mail-data";
import type { Category, Client } from "@/lib/tasks";
import type { TodaySections, TodayTask } from "@/lib/today";
import { plural, type Ball, type DateKey } from "@/lib/domain";
import { moveTaskAction } from "./ukoly/actions";
import { setTaskDueDateAction } from "./kalendar/actions";
import MailTaskDialog, { useMailTask } from "./posta/MailTaskDialog";
import MailReplyDialog, { gmailThreadUrl, useMailReply } from "./posta/MailReplyDialog";
import styles from "./today.module.css";

/** Zpráva na řádku: k údajům z pošty i to, co se počítá na serveru podle Prahy. */
export type TodayMailRow = MailRow & { when: string; initials: string };

export type TodayMail = {
  /** Zprávy, které čekají na odpověď — co spěchá, je první. Jen pár nejhořejších. */
  rows: TodayMailRow[];
  waiting: number;
  urgent: number;
  /** Kdy se pošta naposledy načetla, hotový text podle Prahy. */
  lastSync: string | null;
  /** Adresa schránky — podle ní se v Gmailu vybírá účet. */
  email: string;
  /** Na serveru je klíč k AI, takže jde z e-mailu navrhnout úkol a odpověď. */
  aiAvailable: boolean;
  /** Majitel schránky pomoc AI s e-mailem povolil. */
  aiAllowed: boolean;
};

/** Barva podle toho, u koho úkol leží — stejná jako v Úkolech. */
const TONE: Record<Ball, string> = { me: "o-me", client: "o-client", supplier: "o-supplier", done: "o-done" };

const Sipka = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
const Fajfka = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);

/**
 * Dnes jako přehled „co mám udělat“ — viz `lib/today.ts`. Nahoře čtyři čísla,
 * pod nimi vlevo práce (hoří, na tobě), vpravo to, co přichází a co čeká
 * jinde (pošta, u klienta a u dodavatele). Všechno, co jde vyřídit jedním
 * kliknutím, má tlačítko přímo na řádku.
 */
export default function TodayBoard({
  today,
  dateLabel,
  sections,
  mail,
  clients,
  categories,
}: {
  /** Dnešek podle Prahy, počítaný na serveru. */
  today: DateKey;
  dateLabel: string;
  sections: TodaySections;
  /** `null`, když člověk nemá připojenou schránku. */
  mail: TodayMail | null;
  clients: Client[];
  categories: Category[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /** Úkol, na kterém se zrovna něco ukládá. */
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  const ukol = useMailTask(() => router.refresh());
  const odpoved = useMailReply();
  const zaneprazdnen = pending || ukol.pending || odpoved.pending;

  function zmen(id: string, akce: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setBusy(id);
    setError(null);
    startTransition(async () => {
      const res = await akce();
      if (!res.ok) setError({ id, message: res.message });
      setBusy(null);
      router.refresh();
    });
  }

  const { burning, mine, mineHidden, waiting, counts } = sections;
  const mineRows = mine.flatMap((g) => g.items);
  // Jen to, co je v téhle skupině — moje úkoly, které hoří, jsou už nahoře.
  const mineCount = mineRows.length + mineHidden;
  const uKlienta = waiting.filter((t) => t.ball === "client").length;
  const uDodavatele = waiting.length - uKlienta;
  const nicNaPraci = burning.length === 0 && mineRows.length === 0 && waiting.length === 0;

  const radek = (t: TodayTask) => (
    <TaskRow
      key={t.id}
      t={t}
      today={today}
      busy={busy === t.id}
      disabled={zaneprazdnen}
      error={error?.id === t.id ? error.message : null}
      onMove={(step) => zmen(t.id, () => moveTaskAction(t.id, step))}
      onDue={(den) => zmen(t.id, () => setTaskDueDateAction(t.id, `${den}T00:00:00.000Z`))}
    />
  );

  const vlevo = burning.length > 0 || mineRows.length > 0;
  const vpravo = (mail !== null && mail.rows.length > 0) || waiting.length > 0;

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <h1 className={styles.h1}>Dnes</h1>
        <p className={styles.date0}>{dateLabel}</p>
      </header>

      {/* Čtyři čísla, na která se člověk ptá jako první — a odkaz rovnou k nim. */}
      <nav className={styles.stats} aria-label="Přehled dne">
        <Stat
          href="#hori"
          tone="o-alarm"
          n={burning.length}
          label={burning.length === 0 ? "nic nehoří" : "hoří"}
          note={
            burning.length === 0
              ? "žádný termín neutekl"
              : [counts.late > 0 && `${counts.late} po termínu`, counts.today > 0 && `${counts.today} dnes`].filter(Boolean).join(" · ")
          }
        />
        <Stat
          href="#natobe"
          tone="o-me"
          n={mineCount}
          label="na tobě"
          note={mineCount === 0 ? "nic dalšího nečeká" : counts.noDue > 0 ? `${counts.noDue} bez termínu` : "všechno má termín"}
        />
        {mail && (
          <Stat
            href={mail.rows.length > 0 ? "#posta" : "/posta"}
            tone="o-note"
            alarm={mail.urgent > 0}
            n={mail.waiting}
            label={plural(mail.waiting, "e-mail čeká", "e-maily čekají", "e-mailů čeká")}
            note={mail.urgent > 0 ? `${mail.urgent} ${plural(mail.urgent, "spěchá", "spěchají", "spěchá")}` : mail.lastSync ? `načteno ${mail.lastSync}` : "na odpověď"}
          />
        )}
        <Stat
          href="#ceka"
          tone="o-client"
          n={waiting.length}
          label="u jiných"
          note={
            waiting.length === 0
              ? "na nikoho se nečeká"
              : [uKlienta > 0 && `${uKlienta} u klienta`, uDodavatele > 0 && `${uDodavatele} u dodavatele`].filter(Boolean).join(" · ")
          }
        />
      </nav>

      {nicNaPraci && <p className={`panel ${styles.calm}`}>Nic nehoří a nic nečeká — všechny úkoly jsou uzavřené.</p>}

      <div className={`${styles.cols} ${vlevo && vpravo ? styles.cols2 : ""}`}>
        {vlevo && (
          <div className={styles.col}>
            {burning.length > 0 && (
              <section id="hori" className={`panel o-alarm ${styles.card} ${styles.cardAlarm}`}>
                <header className={styles.cardHead}>
                  <h2>Hoří</h2>
                  <em className={styles.count}>{burning.length}</em>
                  <span className={styles.hint}>po termínu a dnešní</span>
                </header>
                <ul className={styles.list}>{burning.map(radek)}</ul>
              </section>
            )}

            {mineRows.length > 0 && (
              <section id="natobe" className={`panel o-me ${styles.card}`}>
                <header className={styles.cardHead}>
                  <h2>Na tobě</h2>
                  <em className={styles.count}>{mineCount}</em>
                  <span className={styles.hint}>od nejbližšího termínu</span>
                </header>
                <ul className={styles.list}>{mineRows.map(radek)}</ul>
                {mineHidden > 0 && (
                  <p className={styles.cardFoot}>
                    <Link href="/ukoly?filtr=me">Všechny úkoly na tobě (ještě {mineHidden})</Link>
                  </p>
                )}
              </section>
            )}
          </div>
        )}

        {vpravo && (
          <div className={styles.col}>
            {mail && mail.rows.length > 0 && (
              <section id="posta" className={`panel o-note ${styles.card}`}>
                <header className={styles.cardHead}>
                  <h2>Pošta čeká</h2>
                  <em className={styles.count}>{mail.waiting}</em>
                  {mail.lastSync && <span className={styles.hint}>načteno {mail.lastSync}</span>}
                </header>
                <ul className={styles.list}>
                  {mail.rows.map((m) => (
                    <li key={m.id} className={styles.mrow}>
                      <span className={`${styles.avatar} ${m.priority === "urgent" ? styles.avatarUrgent : ""}`} aria-hidden="true">
                        {m.initials}
                      </span>
                      {/* Kliknutím na zprávu se otevře v Gmailu — stejně jako v Poště. */}
                      <a
                        className={styles.mhead}
                        href={gmailThreadUrl(m.threadId, mail.email)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Otevřít v Gmailu"
                      >
                        <span className={styles.mname}>{m.fromName ?? m.fromEmail}</span>
                        {m.when && <span className={styles.mwhen}>{m.when}</span>}
                        {m.priority === "urgent" && <em className={styles.urgent}>spěchá</em>}
                      </a>
                      <div className={styles.actions}>
                        {mail.aiAvailable ? (
                          <>
                            {!m.taskId && (
                              <button type="button" className="btn btn-sm" disabled={zaneprazdnen} onClick={() => ukol.open(m, mail.aiAllowed)}>
                                Úkol
                              </button>
                            )}
                            <button type="button" className="btn btn-sm" disabled={zaneprazdnen} onClick={() => odpoved.open(m, mail.aiAllowed)}>
                              Odpověď
                            </button>
                          </>
                        ) : (
                          <Link href="/posta" className="btn btn-sm">Otevřít</Link>
                        )}
                      </div>
                      <p className={styles.msub}>
                        {m.clientName && <span className={styles.client}><i />{m.clientName}</span>}
                        {m.summary ?? m.subject ?? "(bez předmětu)"}
                      </p>
                    </li>
                  ))}
                </ul>
                <p className={styles.cardFoot}>
                  <Link href="/posta">
                    {mail.waiting > mail.rows.length ? `Všechna pošta (ještě ${mail.waiting - mail.rows.length})` : "Otevřít poštu"}
                  </Link>
                </p>
              </section>
            )}

            {waiting.length > 0 && (
              <section id="ceka" className={`panel o-client ${styles.card}`}>
                <header className={styles.cardHead}>
                  <h2>Čeká se na jiné</h2>
                  <em className={styles.count}>{waiting.length}</em>
                  <span className={styles.hint}>urguj, když to trvá</span>
                </header>
                <ul className={styles.list}>{waiting.map(radek)}</ul>
              </section>
            )}
          </div>
        )}
      </div>

      <p className={styles.foot}>
        <Link href="/ukoly">Všechny úkoly</Link>
        <span>·</span>
        <span>Uzavřeno {counts.done}</span>
        <span>·</span>
        <Link href="/report">Report</Link>
      </p>

      <MailTaskDialog task={ukol} clients={clients} categories={categories} today={today} />
      {mail && <MailReplyDialog reply={odpoved} account={mail.email} />}
    </div>
  );
}

/** Dlaždice s číslem. Nula je klidná — bez barvy, ať nekřičí, že je něco v pořádku. */
function Stat({ href, tone, n, label, note, alarm = false }: { href: string; tone: string; n: number; label: string; note: string; alarm?: boolean }) {
  const obsah = (
    <>
      <b>{n}</b>
      <span className={styles.statText}>
        <span className={styles.statLabel}>{label}</span>
        <small className={alarm ? styles.statAlarm : undefined}>{note}</small>
      </span>
    </>
  );
  const trida = `${styles.stat} ${n > 0 ? tone : styles.statZero}`;
  return href.startsWith("#") ? <a href={href} className={trida}>{obsah}</a> : <Link href={href} className={trida}>{obsah}</Link>;
}

/**
 * Řádek úkolu: dílky štafety, název, komu patří a kde stojí, termín a posun
 * o krok. Termín je tlačítko — kliknutím se otevře kalendář a nové datum se
 * rovnou uloží.
 */
function TaskRow({
  t,
  today,
  busy,
  disabled,
  error,
  onMove,
  onDue,
}: {
  t: TodayTask;
  today: DateKey;
  busy: boolean;
  disabled: boolean;
  error: string | null;
  onMove: (step: number) => void;
  onDue: (den: string) => void;
}) {
  const kalendar = useRef<HTMLInputElement>(null);
  /** Prohlížeč neumí otevřít kalendář sám — ukáže se obyčejné pole s datem. */
  const [rucne, setRucne] = useState(false);

  function otevriKalendar() {
    const pole = kalendar.current;
    try {
      if (pole && typeof pole.showPicker === "function") {
        pole.showPicker();
        return;
      }
    } catch {
      // Spadne do ručního pole níž.
    }
    setRucne(true);
  }

  const zmenTermin = (den: string) => {
    setRucne(false);
    if (den && den !== t.dueKey) onDue(den);
  };

  const tone = t.late ? "o-alarm" : TONE[t.ball];
  const dueClass = t.dueTone === "late" ? styles.dueLate : t.dueTone === "today" ? styles.dueToday : t.dueTone === "none" ? styles.dueNone : "";

  return (
    <li className={`${styles.row} ${busy ? styles.rowBusy : ""}`}>
      <span className={`${styles.pips} ${tone}`} title={`${t.stepName} — krok ${t.step + 1} z ${t.steps.length}`} aria-hidden="true">
        {t.steps.map((s, i) => (
          <i key={s.label} className={i < t.step ? styles.pipOn : i === t.step ? styles.pipAt : undefined} />
        ))}
      </span>

      <div className={styles.main}>
        <span className={styles.title}>{t.title}</span>
        <span className={styles.meta}>
          {t.lateDays > 0 && (
            <b className={styles.lateTxt}>{t.lateDays} {plural(t.lateDays, "den", "dny", "dní")} po termínu</b>
          )}
          {/* U cizích úkolů je nejdůležitější, kde leží — proto je to první a barevně. */}
          {t.ball !== "me" && (
            <span className={`${styles.where} ${TONE[t.ball]}`}>
              {t.stepName}{t.supplierName ? ` · ${t.supplierName}` : ""}
            </span>
          )}
          {t.clientName && (
            <span className={styles.client} title={t.clientName}>
              <i style={t.clientColor ? { background: t.clientColor } : undefined} />
              {t.clientName}
            </span>
          )}
          {t.ball === "me" && <span>{t.stepName}</span>}
        </span>
        {error && <span className={styles.err} role="alert">{error}</span>}
      </div>

      <div className={styles.dueCell}>
        {rucne ? (
          <input
            type="date"
            className={`field ${styles.date}`}
            aria-label={`Termín úkolu ${t.title}`}
            defaultValue={t.dueKey ?? ""}
            autoFocus
            disabled={disabled}
            onChange={(e) => zmenTermin(e.target.value)}
            onBlur={() => setRucne(false)}
          />
        ) : (
          <>
            <button
              type="button"
              className={`${styles.due} ${dueClass}`}
              disabled={disabled}
              title={t.dueLabel ? "Změnit termín" : "Dát termín"}
              aria-label={t.dueLabel ? `Termín ${t.dueLabel}, změnit` : `Dát termín úkolu ${t.title}`}
              onClick={otevriKalendar}
            >
              {t.dueLabel ?? "+ termín"}
            </button>
            {/* Neviditelné pole jen kvůli kalendáři prohlížeče — otevírá ho tlačítko nad ním. */}
            <input
              ref={kalendar}
              type="date"
              className={styles.dueNative}
              tabIndex={-1}
              aria-hidden="true"
              min={today}
              defaultValue={t.dueKey ?? ""}
              onChange={(e) => zmenTermin(e.target.value)}
            />
          </>
        )}
      </div>

      <div className={styles.actions}>
        {t.next && (
          <button
            type="button"
            className={`btn btn-sm ${styles.go}`}
            disabled={disabled}
            title={`Posunout na „${t.next.label}“`}
            onClick={() => onMove(t.next!.step)}
          >
            {t.finish ? <Sipka /> : <Fajfka />}
            {t.next.label}
          </button>
        )}
        {t.finish && (
          <button
            type="button"
            className={`btn btn-sm btn-ghost ${styles.fin}`}
            disabled={disabled}
            title={`Rovnou „${t.finish.label}“`}
            aria-label={`Rovnou ${t.finish.label}: ${t.title}`}
            onClick={() => onMove(t.finish!.step)}
          >
            <Fajfka />
          </button>
        )}
      </div>
    </li>
  );
}
