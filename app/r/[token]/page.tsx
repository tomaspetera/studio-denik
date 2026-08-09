import type { Metadata } from "next";
import { loadPublicReport } from "@/lib/report";
import { BALL_LABEL, tasksWord, type Ball } from "@/lib/domain";
import styles from "./shared.module.css";

export const dynamic = "force-dynamic";

const TONES = ["var(--accent)", "var(--supplier)", "var(--client)", "var(--done)", "var(--muted)"];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const r = await loadPublicReport(token);
  return {
    title: r ? `Report ${r.label ?? ""} — ${r.org_name}`.trim() : "Report",
    // Sdílený odkaz nemá co dělat ve vyhledávačích.
    robots: { index: false, follow: false },
  };
}

export default async function SharedReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const r = await loadPublicReport(token);

  if (!r) return <Unavailable />;

  const snap = r.snapshot;

  return (
    <main className={styles.stage}>
      <article className={styles.sheet}>
        {(["a", "b", "c", "d"] as const).map((k) => (
          <svg key={k} className={`${styles.reg} ${styles[k]}`} viewBox="0 0 20 20" fill="none" strokeWidth="1">
            <circle cx="10" cy="10" r="6" />
            <path d="M10 0v20M0 10h20" />
          </svg>
        ))}

        <header className={styles.head}>
          <div className={styles.studio}>
            <span className={styles.logo} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.2" strokeLinecap="round">
                <path d="M4 6h16M4 12h11M4 18h7" />
              </svg>
            </span>
            <span>
              <span className={styles.studioName}>{r.org_name}</span>
              {r.sender_mail && <span className={styles.studioSub}>{r.sender_mail}</span>}
            </span>
          </div>
          <div className={styles.meta}>
            {r.label && <div>Report <b>{r.label}</b></div>}
            {r.published_at && (
              <div>Vystaveno <b>{formatDate(r.published_at)}</b></div>
            )}
          </div>
        </header>

        <h1 className={styles.title}>Týdenní přehled odvedené práce</h1>
        <p className={styles.period}>{snap?.rangeText ?? formatRange(r.starts_on, r.ends_on)}</p>

        {r.summary && (
          <section className={styles.sec}>
            <h2>Shrnutí</h2>
            <div className={styles.lede}>
              {r.summary.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}
            </div>
          </section>
        )}

        {snap && (
          <>
            <section className={styles.sec}>
              <h2>Čísla za týden</h2>
              <div className={styles.nums}>
                <Num tone="done" value={snap.counts.done} label="uzavřených úkolů" />
                <Num tone="me" value={snap.counts.me} label="rozpracováno" />
                <Num tone="client" value={snap.counts.client} label="čeká na klienta" />
                <Num tone="supplier" value={snap.counts.supplier} label="u dodavatele" />
              </div>
            </section>

            {snap.byCategory.length > 0 && (
              <section className={styles.sec}>
                <h2>Kam šel týden</h2>
                <div className={styles.stack}>
                  {snap.byCategory.map((c, i) => (
                    <i key={c.category} style={{ flexGrow: c.percent, background: TONES[i % TONES.length] }}>
                      {c.percent >= 8 ? `${c.percent} %` : ""}
                    </i>
                  ))}
                </div>
                <ul className={styles.keys}>
                  {snap.byCategory.map((c, i) => (
                    <li key={c.category}>
                      <i style={{ background: TONES[i % TONES.length] }} />
                      <span>{c.category}</span>
                      <b style={{ color: TONES[i % TONES.length] }}>{c.percent} %</b>
                      <em>{c.count} {tasksWord(c.count)}</em>
                    </li>
                  ))}
                </ul>
                <p className={styles.footnote}>
                  Procenta vycházejí z velikosti úkolů, ne z odpracovaných hodin.
                </p>
              </section>
            )}

            {snap.byClient.length > 0 && (
              <section className={styles.sec}>
                <h2>Po klientech</h2>
                <div className={styles.clients}>
                  {snap.byClient.map((g) => (
                    <div key={g.client} className={styles.client}>
                      <div className={styles.clientHead}>
                        <b>{g.client}</b>
                        <span>{g.items.length} {tasksWord(g.items.length)} · {g.percent} % týdne</span>
                      </div>
                      <ul className={styles.items}>
                        {g.items.map((t, i) => (
                          <li key={i}>
                            <span className={`${styles.mark} o-${t.isLate ? "alarm" : t.ball}`} aria-hidden="true">
                              {t.ball === "done" ? (
                                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M4 12l6 6L20 6" />
                                </svg>
                              ) : (
                                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round">
                                  <circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" />
                                </svg>
                              )}
                            </span>
                            <span>
                              {t.title}
                              {t.ball !== "done" && (
                                <em className={styles.state}>
                                  {" — "}{t.stepName}
                                  {t.supplierName ? `, ${t.supplierName}` : ""}
                                  {t.isLate ? ", po termínu" : ""}
                                </em>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {snap.waiting.length > 0 && (
              <section className={styles.sec}>
                <h2>Čeká se na</h2>
                <div className={styles.waiting}>
                  {snap.waiting.map((w, i) => (
                    <div key={i} className={styles.wait}>
                      <span>
                        <b>{w.title}</b>
                        <em>
                          {w.clientName ?? "bez klienta"}
                          {w.supplierName ? ` · ${w.supplierName}` : ""}
                        </em>
                      </span>
                      <span className={`pill o-${w.isLate ? "alarm" : w.ball}`}>
                        {w.isLate ? "po termínu" : BALL_LABEL[w.ball]}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {r.outlook && (
          <section className={styles.sec}>
            <h2>Příští týden</h2>
            <div className={styles.lede}>
              {r.outlook.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}
            </div>
          </section>
        )}

        <footer className={styles.foot}>
          <span>
            {r.sender ?? r.org_name}
            {r.sender_mail ? ` · ${r.sender_mail}` : ""}
          </span>
          {r.label && <span className="mono">{r.label}</span>}
        </footer>
      </article>

      <p className={styles.hint}>
        Tenhle přehled ti někdo poslal odkazem. Nepotřebuješ účet ani přihlášení.
      </p>
    </main>
  );
}

function Num({ tone, value, label }: { tone: Ball; value: number; label: string }) {
  return (
    <div className={`${styles.num} o-${tone}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

/**
 * Odkaz neplatí. Záměrně neříkáme proč — jestli neexistuje, ještě nebyl
 * publikovaný, nebo mu vypršela platnost. Návštěvník to stejně nespraví
 * a rozlišování by prozrazovalo, které tokeny existují.
 */
function Unavailable() {
  return (
    <main className={styles.stage}>
      <div className={styles.gone}>
        <span className={styles.goneMark} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16h.01" />
          </svg>
        </span>
        <h1>Odkaz není platný</h1>
        <p>
          Report na téhle adrese není dostupný. Odkazy mají omezenou platnost —
          požádej odesílatele o nový.
        </p>
      </div>
    </main>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

function formatRange(from: string, to: string): string {
  const a = new Date(from);
  const b = new Date(to);
  return `${a.getDate()}. ${a.getMonth() + 1}. – ${b.getDate()}. ${b.getMonth() + 1}. ${b.getFullYear()}`;
}
