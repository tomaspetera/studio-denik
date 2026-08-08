"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BALL_LABEL, closedTasksPhrase, tasksWord, type Ball } from "@/lib/domain";
import type { Provider } from "@/lib/ai";
import type { StoredReport } from "@/lib/report";
import { ERROR_MARK } from "@/lib/stream-marks";
import { saveEditAction, publishAction } from "./actions";
import styles from "./report.module.css";

type Item = {
  title: string;
  ball: Ball;
  stepName: string;
  supplierName: string | null;
  isLate: boolean;
};

type Data = {
  label: string;
  rangeText: string;
  counts: { done: number; me: number; client: number; supplier: number; late: number };
  byCategory: { category: string; percent: number; count: number }[];
  byClient: { client: string; percent: number; items: Item[] }[];
  waiting: {
    title: string;
    clientName: string | null;
    supplierName: string | null;
    ball: Ball;
    isLate: boolean;
  }[];
};

const TONES = ["var(--accent)", "var(--supplier)", "var(--client)", "var(--done)", "var(--muted)"];

export default function ReportView({
  data,
  stored,
  providers,
  org,
  siteUrl,
}: {
  data: Data;
  stored: StoredReport | null;
  providers: Provider[];
  org: { name: string; email: string };
  siteUrl: string;
}) {
  const router = useRouter();
  const [provider, setProvider] = useState<Provider | undefined>(providers[0]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(stored?.edited_summary ?? stored?.ai_summary ?? "");
  const [copied, setCopied] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [live, setLive] = useState("");
  const [pending, startTransition] = useTransition();

  const busy = pending || streaming;

  const text = stored?.edited_summary ?? stored?.ai_summary ?? "";
  const edited = Boolean(stored?.edited_summary);

  /**
   * Generování jede přes stream, ne přes serverovou akci — hostingy omezují,
   * jak dlouho smí funkce běžet, a stream ten limit obchází. Vedlejší přínos:
   * text je vidět vznikat, takže je zřejmé, že se něco děje.
   */
  async function generate() {
    setError(null);
    setLive("");
    setStreaming(true);

    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });

      if (!res.ok || !res.body) {
        setError(await res.text().catch(() => "Generování se nepodařilo spustit."));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });

        // Chyba přišla uprostřed streamu — text před ní zahodíme,
        // ať se nedostane do reportu půlka věty.
        const mark = acc.indexOf(ERROR_MARK);
        if (mark >= 0) {
          setError(acc.slice(mark + ERROR_MARK.length).trim());
          setLive("");
          return;
        }

        setLive(acc);
      }

      setDraft(acc.trim());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Spojení se přerušilo.");
    } finally {
      setStreaming(false);
      setLive("");
    }
  }

  function save() {
    if (!stored) return;
    startTransition(async () => {
      await saveEditAction(stored.id, draft);
      setEditing(false);
      router.refresh();
    });
  }

  function publish() {
    if (!stored) return;
    startTransition(async () => {
      await publishAction(stored.id, org.email);
      router.refresh();
    });
  }

  async function copyLink() {
    if (!stored) return;
    const base = siteUrl || window.location.origin;
    await navigator.clipboard.writeText(`${base}/r/${stored.share_token}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  /**
   * PDF necháme vytisknout prohlížeč. Tiskový styl schová celé rozhraní
   * a zůstane jen arch — výsledek je tedy totožný s tím, co je vidět
   * na obrazovce, a nemusíme dokument kreslit podruhé v knihovně.
   *
   * Název souboru si prohlížeč bere z titulku stránky, proto ho na dobu
   * tisku přepneme a hned vrátíme zpátky.
   */
  function toPdf() {
    const original = document.title;
    document.title = `Report ${data.label} — ${org.name}`.replace(/[\\/:*?"<>|]/g, "-");
    const restore = () => {
      document.title = original;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
    // Safari „afterprint“ nespouští spolehlivě — pojistka.
    setTimeout(restore, 60_000);
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.bar}>
        <div>
          <h1 className={styles.h1}>Report</h1>
          <p className={styles.sub}>
            {data.label} · {data.rangeText}
            {stored?.status === "published" ? " · publikováno" : stored ? " · koncept" : ""}
          </p>
        </div>

        <div className={styles.tools}>
          {providers.length > 1 && (
            <div className={styles.seg}>
              {providers.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProvider(p)}
                  className={provider === p ? styles.segOn : ""}
                >
                  {p === "claude" ? "Claude" : "Gemini"}
                </button>
              ))}
            </div>
          )}

          <button type="button" className="btn" onClick={generate} disabled={busy || providers.length === 0}>
            <svg viewBox="0 0 24 24">
              <path d="M12 3l1.9 5.3L19 10l-5.1 1.7L12 17l-1.9-5.3L5 10l5.1-1.7z" />
            </svg>
            <span>{streaming ? "Píšu…" : text ? "Přegenerovat" : "Vygenerovat"}</span>
          </button>

          {text && !streaming && (
            <button type="button" className="btn" onClick={toPdf} title="Otevře tiskový dialog — vyber „Uložit jako PDF“">
              <svg viewBox="0 0 24 24">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <path d="M7 10l5 5 5-5M12 15V3" />
              </svg>
              <span>PDF</span>
            </button>
          )}

          {stored && (
            <button type="button" className="btn btn-primary" onClick={stored.status === "published" ? copyLink : publish} disabled={busy}>
              {stored.status === "published"
                ? copied ? "Zkopírováno" : "Kopírovat odkaz"
                : "Publikovat"}
            </button>
          )}
        </div>
      </header>

      {providers.length === 0 && (
        <p className={styles.warn}>
          Není nastavený žádný AI klíč. Doplň <code>GEMINI_API_KEY</code> nebo{" "}
          <code>ANTHROPIC_API_KEY</code> do <code>.env.local</code> a restartuj server.
        </p>
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}

      {/* ---------------- papírový arch ---------------- */}
      <div className={styles.stage}>
        <article className={styles.sheet}>
          <Reg />

          <header className={styles.sheetHead}>
            <div className={styles.studio}>
              <span className={styles.logo} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M4 6h16M4 12h11M4 18h7" />
                </svg>
              </span>
              <span>
                <span className={styles.studioName}>{org.name}</span>
                <span className={styles.studioSub}>{org.email}</span>
              </span>
            </div>
            <div className={styles.meta}>
              <div>Report <b>{data.label}</b></div>
              <div>Vystaveno <b>{today()}</b></div>
            </div>
          </header>

          <h2 className={styles.title}>Týdenní přehled odvedené práce</h2>
          <p className={styles.period}>{data.rangeText}</p>

          <section className={styles.sec}>
            <h3>Shrnutí</h3>
            {streaming ? (
              <div className={styles.lede}>
                {live
                  ? live.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)
                  : <p className={styles.placeholder}>Čekám na první slova…</p>}
                <span className={styles.caret} aria-hidden="true" />
              </div>
            ) : editing ? (
              <>
                <textarea
                  className={styles.editor}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={10}
                />
                <div className={styles.editActs}>
                  <button type="button" className="btn btn-primary" onClick={save} disabled={pending}>
                    Uložit úpravy
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => { setDraft(text); setEditing(false); }}>
                    Zrušit
                  </button>
                </div>
              </>
            ) : text ? (
              <>
                <div className={styles.lede}>
                  {text.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}
                </div>
                <div className={styles.aiNote}>
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.7">
                    <path d="M12 3l1.9 5.3L19 10l-5.1 1.7L12 17l-1.9-5.3L5 10l5.1-1.7z" />
                  </svg>
                  <span>
                    {edited
                      ? "Text jsi upravil ručně. Původní verze od AI zůstala uložená — přegenerování ji přepíše, tvoje úpravy ne."
                      : `Text sestavil ${stored?.model === "claude" ? "Claude" : "Gemini"} z ${closedTasksPhrase(data.counts.done)}.`}
                  </span>
                  <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
                    Upravit
                  </button>
                </div>
              </>
            ) : (
              <p className={styles.placeholder}>
                Zatím tu není žádný text. Klikni na <b>Vygenerovat</b> — shrnutí
                se sestaví z toho, co je za tenhle týden uzavřené.
              </p>
            )}
          </section>

          <section className={styles.sec}>
            <h3>Čísla za týden</h3>
            <div className={styles.nums}>
              <Num tone="done" value={data.counts.done} label="uzavřených úkolů" />
              <Num tone="me" value={data.counts.me} label="rozpracováno" />
              <Num tone="client" value={data.counts.client} label="čeká na klienta" />
              <Num tone="supplier" value={data.counts.supplier} label="u dodavatele" />
            </div>
          </section>

          {data.byCategory.length > 0 && (
            <section className={styles.sec}>
              <h3>Kam šel týden</h3>
              <div className={styles.stack}>
                {data.byCategory.map((c, i) => (
                  <i key={c.category} style={{ flexGrow: c.percent, background: TONES[i % TONES.length] }}>
                    {c.percent >= 8 ? `${c.percent} %` : ""}
                  </i>
                ))}
              </div>
              <ul className={styles.keys}>
                {data.byCategory.map((c, i) => (
                  <li key={c.category}>
                    <i style={{ background: TONES[i % TONES.length] }} />
                    <span>{c.category}</span>
                    <b style={{ color: TONES[i % TONES.length] }}>{c.percent} %</b>
                    <em>{c.count} {tasksWord(c.count)}</em>
                  </li>
                ))}
              </ul>
              <p className={styles.footnote}>
                Procenta se počítají z velikosti úkolů, ne z hodin — vykazovat
                čas znamená stopky a ty nikdo dlouhodobě nedělá.
              </p>
            </section>
          )}

          {data.byClient.length > 0 && (
            <section className={styles.sec}>
              <h3>Po klientech</h3>
              <div className={styles.clients}>
                {data.byClient.map((g) => (
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

          {data.waiting.length > 0 && (
            <section className={styles.sec}>
              <h3>Čeká se na</h3>
              <div className={styles.waiting}>
                {data.waiting.map((w, i) => (
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

          <footer className={styles.sheetFoot}>
            <span>{org.name} · {org.email}</span>
            <span className="mono">{data.label}</span>
          </footer>
        </article>
      </div>

      {stored?.status === "published" && (
        <p className={styles.shared}>
          Publikováno. Odkaz platí do{" "}
          <b>{new Date(stored.share_until).toLocaleDateString("cs-CZ")}</b> a otevře
          ho i nepřihlášený člověk.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Num({ tone, value, label }: { tone: string; value: number; label: string }) {
  return (
    <div className={`${styles.num} o-${tone}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function Reg() {
  return (
    <>
      {(["a", "b", "c", "d"] as const).map((k) => (
        <svg key={k} className={`${styles.reg} ${styles[k]}`} viewBox="0 0 20 20" fill="none" strokeWidth="1">
          <circle cx="10" cy="10" r="6" />
          <path d="M10 0v20M0 10h20" />
        </svg>
      ))}
    </>
  );
}

function today(): string {
  return new Date().toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });
}
