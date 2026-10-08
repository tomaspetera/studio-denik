import { redirect } from "next/navigation";
import Link from "next/link";
import { getWorkspace } from "@/lib/workspace";
import { signOut } from "../prihlaseni/actions";
import { listCategories, listClients, listTasks } from "@/lib/tasks";
import { loadTeam } from "@/lib/team";
import { loadCapacity } from "@/lib/capacity";
import { listPriorityClientIds } from "@/lib/clients";
import { loadAttention } from "@/lib/attention-data";
import { supabaseServer } from "@/lib/supabase/server";
import { isMailAiAvailable, listMail, loadMailAccount } from "@/lib/mail-data";
import { mailBucket, sortWaiting } from "@/lib/mail-buckets";
import { lastSyncLabel } from "@/lib/mail-schedule";
import { initials, mailWhen } from "@/lib/mail-face";
import { buildToday } from "@/lib/today";
import { loadWaitingInfo } from "@/lib/waiting-data";
import { loadPlans } from "@/lib/week-data";
import AttentionPanel from "./AttentionPanel";
import TodayBoard, { type TodayMail } from "./TodayBoard";
import { csDate, csDateFromKey } from "@/lib/domain";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

/** Kolik čekajících zpráv se na Dnes ukáže — zbytek je za odkazem do Pošty. */
const MAIL_ROWS = 5;

export default async function DnesPage() {
  const ws = await getWorkspace();
  if (!ws) redirect("/prihlaseni");

  if (ws.state !== "ready") return <SetupNeeded ws={ws} />;

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const [tasks, plany, { members }, capacity, attention, priorityIds, ucet, zpravy] = await Promise.all([
    listTasks(ws.orgId),
    loadPlans(ws.orgId),
    loadTeam(ws.orgId),
    loadCapacity(ws.orgId),
    loadAttention(supabase, ws.orgId),
    listPriorityClientIds(ws.orgId),
    // Pošta je soukromá — vidí ji jen majitel schránky, ne celé studio.
    user ? loadMailAccount(user.id) : null,
    user ? listMail(user.id) : [],
  ]);
  // Klienti a kategorie jsou potřeba jen v okně s návrhem úkolu z e-mailu.
  const [klienti, kategorie] = ucet ? await Promise.all([listClients(ws.orgId), listCategories(ws.orgId)]) : [[], []];

  // Jak dlouho úkoly leží u klienta a u dodavatele — z historie, jen pro ty, které tam leží.
  const cekani = await loadWaitingInfo(
    ws.orgId,
    tasks.filter((t) => t.ball === "client" || t.ball === "supplier").map((t) => t.id),
  );
  const ukoly = tasks.map((t) => {
    const c = cekani.get(t.id);
    return { ...t, step_since: c?.since ?? null, nudged_at: c?.nudgedAt ?? null, planned_for: plany.get(t.id) ?? null };
  });

  const dnes = new Date();
  const capacityByUser = new Map(capacity.map((c) => [c.userId, c]));
  const maxLoad = Math.max(1, ...capacity.map((c) => c.loadSize));

  const ceka = sortWaiting(zpravy.filter((m) => mailBucket(m) === "urgent" || mailBucket(m) === "reply"));
  const posta: TodayMail | null = ucet
    ? {
        rows: ceka.slice(0, MAIL_ROWS).map((m) => ({ ...m, when: mailWhen(m.receivedAt, dnes), initials: initials(m.fromName, m.fromEmail) })),
        waiting: ceka.length,
        urgent: ceka.filter((m) => mailBucket(m) === "urgent").length,
        lastSync: lastSyncLabel(ucet.lastSyncAt),
        email: ucet.email,
        aiAvailable: isMailAiAvailable(),
        aiAllowed: Boolean(ucet.aiConsentAt),
      }
    : null;

  // Den v týdnu podle Prahy — server běží v jiném pásmu než čtenář.
  const denVTydnu = new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", weekday: "long" }).format(dnes);

  // Bez úkolů a bez čekající pošty není co řadit — místo prázdného seznamu pozvánka.
  const prazdno = tasks.length === 0 && (!posta || posta.rows.length === 0);

  return (
    <div className={styles.wrap}>
      {prazdno ? (
        <>
          <header className={styles.head}>
            <div>
              <h1 className={styles.h1}>Dnes</h1>
              <p className={styles.sub}>{csDate(dnes)}</p>
            </div>
          </header>
          <section className={styles.hero}>
            <span className="eyebrow">Pracovní prostor {ws.orgName}</span>
            <h2 className={styles.heroTitle}>Zatím je tu prázdno</h2>
            <p className={styles.heroLead}>
              Zapiš první úkol a přehled se začne plnit sám. Každý úkol má typ,
              typ určuje kroky štafety, a krok určuje, u koho zrovna leží míč —
              u tebe, u klienta, nebo u dodavatele.
            </p>
            <Link href="/ukoly?zapsat=1" className="btn btn-primary btn-lg">
              Zapsat první úkol
            </Link>
          </section>
        </>
      ) : (
        <TodayBoard
          today={attention.today}
          dateLabel={`${denVTydnu} ${csDateFromKey(attention.today)}`}
          sections={buildToday(ukoly, attention.today, priorityIds)}
          signature={ws.fullName}
          mail={posta}
          clients={klienti}
          categories={kategorie}
        />
      )}

      {/* Poptávky a sliby bez dalšího kroku. Když nic neleží ladem, zbude z panelu jen nastavení. */}
      <AttentionPanel items={attention.items} today={attention.today} silenceDays={attention.silenceDays} />

      {members.length > 1 && (
        <section className="panel" style={{ marginTop: "var(--s5)" }}>
          <header className={styles.panelHead}>
            <h2>Tým dnes</h2>
            <span className={styles.note}>
              {/* Bez hodin — počet a velikost otevřených úkolů, stejně jako v Týmu. */}
              podle otevřených úkolů
            </span>
          </header>
          <ul className={styles.list}>
            {members.map((m) => {
              const cap = capacityByUser.get(m.userId);
              return (
                <li key={m.userId}>
                  <span className={styles.itemTitle}>
                    {m.fullName ?? m.email}
                    {cap?.absentToday && (
                      <em className={styles.awayTag} title={cap.absentUntil ? `Do ${csDateFromKey(cap.absentUntil)}` : undefined}>
                        pryč
                      </em>
                    )}
                  </span>
                  <span className={styles.capBarTrack}>
                    <span
                      className={styles.capBarFill}
                      style={{ width: `${((cap?.loadSize ?? 0) / maxLoad) * 100}%` }}
                    />
                  </span>
                  <span className={styles.itemRight}>{cap?.openCount ?? 0}</span>
                </li>
              );
            })}
          </ul>
          <footer className={styles.panelFoot}>
            <Link href="/tym" className="btn">Zapsat nepřítomnost</Link>
          </footer>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dokud není databáze připravená, skořápka se nekreslí — tahle stránka */
/* musí mít vlastní hlavičku a poradit, co dodělat.                     */
/* ------------------------------------------------------------------ */

function SetupNeeded({
  ws,
}: { ws: { state: "schema-missing" | "error"; email: string; detail: string } }) {
  const missing = ws.state === "schema-missing";

  return (
    <main className={styles.setupStage}>
      <header className={styles.setupTop}>
        <span className={styles.setupBrand}>Studio Deník</span>
        <span className={styles.spacer} />
        <span className={styles.setupMail}>{ws.email}</span>
        <form action={signOut}>
          <button type="submit" className="btn btn-ghost">Odhlásit</button>
        </form>
      </header>

      <div className={styles.setupBody}>
        <section className={styles.setupCard}>
          <span className="eyebrow" style={{ color: "var(--alarm)" }}>
            {missing ? "Chybí databáze" : "Něco se nepovedlo"}
          </span>
          <h1 className={styles.h1} style={{ marginTop: "var(--s3)" }}>
            {missing ? "Zbývá spustit schéma" : "Databáze odpověděla chybou"}
          </h1>

          {missing && (
            <>
              <p className={styles.heroLead}>
                Přihlášení funguje, ale v databázi zatím nejsou tabulky.
                Spusť migraci a stránku obnov.
              </p>
              <ol className={styles.steps}>
                <li>
                  <b>Supabase → SQL Editor → New query</b>
                  <span>V levém svislém menu, ikona terminálu.</span>
                </li>
                <li>
                  <b>Vlož obsah souboru a spusť</b>
                  <span><code>supabase/migrations/0001_schema.sql</code></span>
                </li>
                <li>
                  <b>Obnov vyrovnávací paměť</b>
                  <span><code>notify pgrst, &apos;reload schema&apos;;</code></span>
                </li>
              </ol>
            </>
          )}

          <p className={styles.detail}>{ws.detail}</p>
        </section>
      </div>
    </main>
  );
}
