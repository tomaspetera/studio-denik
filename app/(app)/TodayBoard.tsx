"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MailRow } from "@/lib/mail-data";
import type { Category, Client } from "@/lib/tasks";
import type { TodaySections, TodayTask } from "@/lib/today";
import { BUCKET_LABEL } from "@/lib/buckets";
import { plural, type DateKey } from "@/lib/domain";
import { moveTaskAction } from "./ukoly/actions";
import { setTaskDueDateAction } from "./kalendar/actions";
import MailTaskDialog, { useMailTask } from "./posta/MailTaskDialog";
import MailReplyDialog, { useMailReply } from "./posta/MailReplyDialog";
import styles from "./today.module.css";

export type TodayMail = {
  /** Zprávy, které čekají na odpověď — co spěchá, je první. Jen pár nejhořejších. */
  rows: MailRow[];
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

/**
 * Dnes jako jeden seznam „co mám udělat“ — viz `lib/today.ts`. Všechno, co
 * jde vyřídit jedním kliknutím, má tlačítko přímo na řádku: posun úkolu
 * o krok, termín, úkol nebo odpověď z e-mailu.
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
  /** Úkol, u kterého je otevřený výběr termínu. */
  const [picking, setPicking] = useState<string | null>(null);

  const ukol = useMailTask(() => router.refresh());
  const odpoved = useMailReply();
  const zaneprazdnen = pending || ukol.pending || odpoved.pending;

  function zmen(id: string, akce: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setBusy(id);
    setError(null);
    startTransition(async () => {
      const res = await akce();
      if (!res.ok) setError({ id, message: res.message });
      setPicking(null);
      setBusy(null);
      router.refresh();
    });
  }

  const { burning, mine, mineHidden, waiting, counts } = sections;
  const nicNaPraci = burning.length === 0 && mine.length === 0 && waiting.length === 0;
  // Jen to, co je v téhle skupině — moje úkoly, které hoří, jsou už nahoře.
  const mineCount = mine.reduce((n, g) => n + g.items.length, 0) + mineHidden;

  const radek = (t: TodayTask) => (
    <li key={t.id} className={`${styles.row} ${busy === t.id ? styles.rowBusy : ""}`}>
      <div className={styles.main}>
        <span className={styles.title}>{t.title}</span>
        <span className={styles.sub}>{t.sub}</span>
        {error?.id === t.id && <span className={styles.err} role="alert">{error.message}</span>}
      </div>
      {t.clientName && (
        <em className={styles.client}>
          <i style={t.clientColor ? { background: t.clientColor } : undefined} />
          {t.clientName}
        </em>
      )}
      <div className={styles.actions}>
        {picking === t.id ? (
          <>
            <input
              type="date"
              className={`field ${styles.date}`}
              aria-label={`Termín úkolu ${t.title}`}
              min={today}
              autoFocus
              disabled={zaneprazdnen}
              onChange={(e) => {
                const den = e.target.value;
                if (den) zmen(t.id, () => setTaskDueDateAction(t.id, `${den}T00:00:00.000Z`));
              }}
            />
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPicking(null)}>Zrušit</button>
          </>
        ) : (
          <>
            {!t.dueKey && (
              <button type="button" className="btn btn-sm btn-ghost" disabled={zaneprazdnen} onClick={() => setPicking(t.id)}>
                Dát termín
              </button>
            )}
            {t.next && (
              <button
                type="button"
                className="btn btn-sm"
                disabled={zaneprazdnen}
                title={`Posunout na „${t.next.label}“`}
                onClick={() => zmen(t.id, () => moveTaskAction(t.id, t.next!.step))}
              >
                {t.next.label}
              </button>
            )}
            {t.finish && t.dueKey && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={zaneprazdnen}
                title={`Rovnou na „${t.finish.label}“`}
                onClick={() => zmen(t.id, () => moveTaskAction(t.id, t.finish!.step))}
              >
                {t.finish.label}
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.h1}>Dnes</h1>
          <p className={styles.date0}>{dateLabel}</p>
        </div>
        <div className={styles.chips}>
          {counts.late > 0 && (
            <a href="#hori" className={`${styles.chip} ${styles.chipAlarm}`}>{counts.late} po termínu</a>
          )}
          {mail && mail.waiting > 0 && (
            <a href="#posta" className={`${styles.chip} ${mail.urgent > 0 ? styles.chipAlarm : styles.chipNote}`}>
              {mail.waiting} {plural(mail.waiting, "e-mail čeká", "e-maily čekají", "e-mailů čeká")}
            </a>
          )}
          {counts.waiting > 0 && (
            <a href="#ceka" className={styles.chip}>{counts.waiting} u jiných</a>
          )}
        </div>
      </header>

      {burning.length > 0 && (
        <section id="hori" className={styles.section}>
          <h2 className={`${styles.h2} ${styles.h2Alarm}`}>Hoří <em>{burning.length}</em></h2>
          <ul className={`panel ${styles.list}`}>{burning.map(radek)}</ul>
        </section>
      )}

      {mail && mail.rows.length > 0 && (
        <section id="posta" className={styles.section}>
          <h2 className={styles.h2}>
            Pošta čeká na odpověď <em>{mail.waiting}</em>
            {mail.lastSync && <span className={styles.h2Note}>načteno {mail.lastSync}</span>}
          </h2>
          <ul className={`panel ${styles.list}`}>
            {mail.rows.map((m) => (
              <li key={m.id} className={styles.row}>
                <div className={styles.main}>
                  <span className={styles.title}>
                    {m.fromName ?? m.fromEmail}
                    {m.priority === "urgent" && <em className={styles.urgent}>spěchá</em>}
                  </span>
                  <span className={styles.sub}>{m.summary ?? m.subject ?? "(bez předmětu)"}</span>
                </div>
                {m.clientName && <em className={styles.client}><i />{m.clientName}</em>}
                <div className={styles.actions}>
                  {mail.aiAvailable ? (
                    <>
                      {!m.taskId && (
                        <button type="button" className="btn btn-sm" disabled={zaneprazdnen} onClick={() => ukol.open(m, mail.aiAllowed)}>
                          Úkol
                        </button>
                      )}
                      <button type="button" className="btn btn-sm btn-ghost" disabled={zaneprazdnen} onClick={() => odpoved.open(m, mail.aiAllowed)}>
                        Odpověď
                      </button>
                    </>
                  ) : (
                    <Link href="/posta" className="btn btn-sm">Otevřít</Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className={styles.more}>
            <Link href="/posta">
              {mail.waiting > mail.rows.length ? `Všechna pošta (ještě ${mail.waiting - mail.rows.length})` : "Otevřít poštu"}
            </Link>
          </p>
        </section>
      )}

      {mine.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.h2}>Na tobě <em>{mineCount}</em></h2>
          <ul className={`panel ${styles.list}`}>
            {mine.map((g) => (
              <li key={g.bucket} className={styles.group}>
                <span className={styles.groupName}>{BUCKET_LABEL[g.bucket]}</span>
                <ul className={styles.list}>{g.items.map(radek)}</ul>
              </li>
            ))}
          </ul>
          {mineHidden > 0 && (
            <p className={styles.more}><Link href="/ukoly?filtr=me">Všechny úkoly na tobě (ještě {mineHidden})</Link></p>
          )}
        </section>
      )}

      {waiting.length > 0 && (
        <section id="ceka" className={styles.section}>
          <h2 className={`${styles.h2} ${styles.h2Quiet}`}>Čeká se na jiné <em>{waiting.length}</em></h2>
          <ul className={`panel ${styles.list}`}>{waiting.map(radek)}</ul>
        </section>
      )}

      {nicNaPraci && <p className={`panel ${styles.calm}`}>Nic nehoří a nic nečeká — všechny úkoly jsou uzavřené.</p>}

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
