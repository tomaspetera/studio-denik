"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MailRow } from "@/lib/mail-data";
import type { Category, Client } from "@/lib/tasks";
import type { TodaySections, TodayTask } from "@/lib/today";
import { plural, type Ball, type DateKey } from "@/lib/domain";
import { shortDateLabel } from "@/lib/buckets";
import { quickDates, type QuickDate } from "@/lib/quick-dates";
import { WAIT_LONG_DAYS, waitLabel } from "@/lib/nudge";
import { moveTaskAction } from "./ukoly/actions";
import { setTaskDueDateAction } from "./kalendar/actions";
import MailTaskDialog, { useMailTask } from "./posta/MailTaskDialog";
import MailReplyDialog, { gmailThreadUrl, useMailReply } from "./posta/MailReplyDialog";
import ReplyCheck from "./posta/ReplyCheck";
import DueChip from "./DueChip";
import NudgeDialog from "./NudgeDialog";
import { UndoToast, useUndo } from "./Undo";
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
  signature,
  mail,
  clients,
  categories,
}: {
  /** Dnešek podle Prahy, počítaný na serveru. */
  today: DateKey;
  dateLabel: string;
  sections: TodaySections;
  /** Jméno z profilu — podpis v připomínce klientovi. */
  signature: string | null;
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
  /** Úkol, ke kterému je otevřené okno s připomínkou klientovi. */
  const [nudging, setNudging] = useState<TodayTask | null>(null);

  const ukol = useMailTask(() => router.refresh());
  const odpoved = useMailReply();
  const zaneprazdnen = pending || ukol.pending || odpoved.pending;
  const undo = useUndo();
  const rychle = quickDates(today);

  type Vysledek = { ok: true } | { ok: false; message: string };

  /**
   * Uloží změnu a nabídne „Zpět“. `zpet` říká, co se stalo a jak to vrátit —
   * vrácení samo už další „Zpět“ nenabízí.
   */
  function zmen(id: string, akce: () => Promise<Vysledek>, zpet?: { text: string; akce: () => Promise<Vysledek> }) {
    setBusy(id);
    setError(null);
    undo.hide();
    startTransition(async () => {
      const res = await akce();
      if (!res.ok) setError({ id, message: res.message });
      else if (zpet) undo.show({ text: zpet.text, run: () => zmen(id, zpet.akce) });
      setBusy(null);
      router.refresh();
    });
  }

  const termin = (den: string | null) => (den ? `${den}T00:00:00.000Z` : null);

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
      quick={rychle}
      onNudge={() => setNudging(t)}
      onMove={(step, label) =>
        zmen(t.id, () => moveTaskAction(t.id, step), {
          text: `${t.title} → ${label}`,
          akce: () => moveTaskAction(t.id, t.step),
        })
      }
      onDue={(den) =>
        zmen(t.id, () => setTaskDueDateAction(t.id, termin(den)), {
          text: `${t.title}: ${den ? `termín ${shortDateLabel(den)}` : "bez termínu"}`,
          akce: () => setTaskDueDateAction(t.id, termin(t.dueKey)),
        })
      }
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
                        {m.clientName && (
                          <span className={styles.client}>
                            <i style={m.clientColor ? { background: m.clientColor } : undefined} />
                            {m.clientName}
                          </span>
                        )}
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

      <UndoToast undo={undo} disabled={zaneprazdnen} />
      {nudging && (
        <NudgeDialog
          key={nudging.id}
          task={nudging}
          today={today}
          signature={signature}
          account={mail?.email ?? null}
          onClose={() => setNudging(null)}
          onDone={() => {
            setNudging(null);
            router.refresh();
          }}
        />
      )}
      {mail && <ReplyCheck waiting={mail.waiting} />}
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
 * Řádek úkolu: dílky štafety, název, komu patří a kde stojí, termín (viz
 * `DueChip`) a posun o krok.
 */
function TaskRow({
  t,
  today,
  busy,
  disabled,
  error,
  quick,
  onNudge,
  onMove,
  onDue,
}: {
  t: TodayTask;
  today: DateKey;
  busy: boolean;
  disabled: boolean;
  error: string | null;
  /** Termíny na jedno kliknutí — dnes, zítra, v pátek, příští týden. */
  quick: QuickDate[];
  /** Otevře okno s připomínkou klientovi. */
  onNudge: () => void;
  onMove: (step: number, label: string) => void;
  /** `null` = termín z úkolu sundat. */
  onDue: (den: string | null) => void;
}) {
  const tone = t.late ? "o-alarm" : TONE[t.ball];

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
        {/* Co leží jinde: jak dlouho, jestli se už urgovalo, a u klienta rovnou připomínka. */}
        {t.ball !== "me" && (t.waitDays !== null || t.nudged || t.ball === "client") && (
          <span className={styles.wait}>
            {t.waitDays !== null && (
              <span className={t.waitDays >= WAIT_LONG_DAYS ? styles.waitLong : undefined}>čeká {waitLabel(t.waitDays)}</span>
            )}
            {t.nudged && <span>{t.nudged}</span>}
            {t.ball === "client" && (
              <button type="button" className={styles.nudgeBtn} disabled={disabled} onClick={onNudge}>
                {t.nudged ? "Urgovat znovu" : "Urgovat"}
              </button>
            )}
          </span>
        )}
        {error && <span className={styles.err} role="alert">{error}</span>}
      </div>

      <DueChip
        className={styles.dueCell}
        taskTitle={t.title}
        dueKey={t.dueKey}
        label={t.dueLabel}
        tone={t.dueTone}
        today={today}
        quick={quick}
        disabled={disabled}
        onChange={onDue}
      />

      <div className={styles.actions}>
        {t.next && (
          <button
            type="button"
            className={`btn btn-sm ${styles.go}`}
            disabled={disabled}
            title={`Posunout na „${t.next.label}“`}
            onClick={() => onMove(t.next!.step, t.next!.label)}
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
            onClick={() => onMove(t.finish!.step, t.finish!.label)}
          >
            <Fajfka />
          </button>
        )}
      </div>
    </li>
  );
}
