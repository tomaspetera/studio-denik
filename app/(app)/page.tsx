import Link from "next/link";
import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/workspace";
import { signOut } from "../prihlaseni/actions";
import { listTasks, countByBall } from "@/lib/tasks";
import { BALL_HINT, BALL_LABEL, BALL_ORDER, csDate, type Ball } from "@/lib/domain";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

export default async function DnesPage() {
  const ws = await getWorkspace();
  if (!ws) redirect("/prihlaseni");

  if (ws.state !== "ready") return <SetupNeeded ws={ws} />;

  const tasks = await listTasks(ws.orgId);
  const counts = countByBall(tasks);

  const dnes = new Date();
  const hori = tasks.filter((t) => t.is_late);
  const naTobe = tasks.filter((t) => t.ball === "me");

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.h1}>Dnes</h1>
          <p className={styles.sub}>{csDate(dnes)}</p>
        </div>
      </header>

      {tasks.length === 0 ? (
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
      ) : (
        <>
          <div className={styles.strip}>
            <Tile tone="done" label="Uzavřeno" value={counts.done} hint="projde do reportu" />
            <Tile tone="me" label="Na tobě" value={counts.me} hint="nikdo jiný neposune" />
            <Tile tone="client" label="U klienta" value={counts.client} hint="čeká na schválení" />
            <Tile tone="alarm" label="Po termínu" value={counts.late} hint="vyžaduje zásah" />
          </div>

          <div className={styles.cols}>
            <section className="panel">
              <header className={styles.panelHead}>
                <h2>Na tobě</h2>
                <span className={styles.note}>{naTobe.length} úkolů</span>
              </header>
              {naTobe.length === 0 ? (
                <p className={styles.blank}>Nic nečeká — míč je jinde.</p>
              ) : (
                <ul className={styles.list}>
                  {naTobe.slice(0, 6).map((t) => (
                    <li key={t.id}>
                      <span className={styles.itemTitle}>{t.title}</span>
                      <span className={styles.itemSub}>
                        {t.step_name}
                        {t.client_name ? ` · ${t.client_name}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <footer className={styles.panelFoot}>
                <Link href="/ukoly?filtr=me" className="btn">Zobrazit všechny</Link>
              </footer>
            </section>

            <section className="panel">
              <header className={styles.panelHead}>
                <h2>U koho leží míč</h2>
                <span className={styles.note}>{tasks.length} celkem</span>
              </header>
              <div className={styles.share}>
                <div className={styles.shareBar}>
                  {BALL_ORDER.map((b) => (
                    <i
                      key={b}
                      className={`o-${b}`}
                      style={{ flexGrow: counts[b] || 0.001 }}
                    />
                  ))}
                </div>
                <ul className={styles.shareKeys}>
                  {BALL_ORDER.map((b) => (
                    <li key={b} className={`o-${b}`}>
                      <i />
                      <span>{BALL_LABEL[b]}</span>
                      <em>{BALL_HINT[b]}</em>
                      <b>{counts[b]}</b>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>

          {hori.length > 0 && (
            <section className="panel" style={{ marginTop: "var(--s5)" }}>
              <header className={styles.panelHead}>
                <h2>Po termínu</h2>
                <span className={styles.note}>vyžaduje zásah</span>
              </header>
              <ul className={styles.list}>
                {hori.map((t) => (
                  <li key={t.id}>
                    <span className={styles.itemTitle}>{t.title}</span>
                    <span className={styles.itemSub}>
                      {t.step_name}
                      {t.supplier_name ? ` · ${t.supplier_name}` : ""}
                    </span>
                    <span className={`pill o-alarm ${styles.itemRight}`}>
                      {BALL_LABEL[t.ball]}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Tile({
  tone, label, value, hint,
}: { tone: Ball | "alarm"; label: string; value: number; hint: string }) {
  return (
    <div className={`${styles.tile} o-${tone}`}>
      <span className={styles.tileLabel}>{label}</span>
      <span className={styles.tileValue}>{value}</span>
      <span className={styles.tileHint}>{hint}</span>
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
