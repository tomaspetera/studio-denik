"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { csDate, plural, type DateKey } from "@/lib/domain";
import type { MailRow } from "@/lib/mail-data";
import type { Category, Client } from "@/lib/tasks";
import {
  disconnectMailAction,
  ignoreSenderAction,
  setHandledAction,
  setMailAiConsentAction,
  syncMailAction,
  taskFromMailAction,
  unignoreAction,
} from "./actions";
import MailTaskDialog, { useMailTask } from "./MailTaskDialog";
import MailReplyDialog, { gmailThreadUrl, useMailReply } from "./MailReplyDialog";
import styles from "./posta.module.css";

type Filtr = "waiting" | "all" | "handled";

const CHYBY: Record<string, string> = {
  nenastaveno: "Na serveru chybí klíče ke Gmailu. Doplň je v nastavení a zkus to znovu.",
  stav: "Připojení se nepodařilo ověřit. Zkus to prosím znovu.",
  access_denied: "Souhlas nebyl udělen, schránka se nepřipojila.",
};

function kdy(iso: string): string {
  const d = new Date(iso);
  const dnes = new Date();
  const stejnyDen = d.toDateString() === dnes.toDateString();
  return stejnyDen
    ? d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })
    : csDate(d);
}

/**
 * Přehled pošty. Appka má ke Gmailu jen čtení — odpovídá se vždycky
 * v Gmailu, tady se jen vidí, co čeká, a dělají se z toho úkoly.
 */
export default function MailBoard({
  configured,
  account,
  messages,
  ignored,
  justConnected,
  error,
  aiAvailable,
  aiSince,
  clients,
  categories,
  today,
}: {
  configured: boolean;
  account: { email: string; lastSyncAt: string | null; aiConsentAt: string | null } | null;
  messages: MailRow[];
  ignored: { id: string; pattern: string }[];
  justConnected: boolean;
  error: string | null;
  /** Na serveru je klíč ke Gemini, takže AI může s e-mailem pomoct (úkol, poptávka, odpověď). */
  aiAvailable: boolean;
  /** Od kdy je pomoc AI povolená — hotový text, počítaný na serveru podle Prahy. */
  aiSince: string | null;
  clients: Client[];
  categories: Category[];
  /** Dnešek podle Prahy, počítaný na serveru. */
  today: DateKey;
}) {
  const router = useRouter();
  const [filtr, setFiltr] = useState<Filtr>("waiting");
  const [hlaska, setHlaska] = useState<string | null>(error ? (CHYBY[error] ?? error) : null);
  const [uspech, setUspech] = useState<string | null>(justConnected ? "Schránka je připojená. Načti poštu tlačítkem Obnovit." : null);
  const [odpojit, setOdpojit] = useState(false);
  const [nastaveni, setNastaveni] = useState(false);
  const [pending, startTransition] = useTransition();

  const ukol = useMailTask((zprava) => {
    setHlaska(null);
    setUspech(zprava);
    router.refresh();
  });
  const odpoved = useMailReply();

  function run(fn: () => Promise<{ ok: boolean; message?: string; count?: number }>, poUspechu?: (r: { count?: number }) => string | null) {
    setHlaska(null);
    setUspech(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setHlaska(res.message ?? "Nepodařilo se to.");
      else if (poUspechu) setUspech(poUspechu(res));
      router.refresh();
    });
  }

  const ceka = messages.filter((m) => m.status === "waiting" && !m.handledAt);
  const vyrizene = messages.filter((m) => m.handledAt);
  const videt =
    filtr === "waiting" ? ceka : filtr === "handled" ? vyrizene : messages.filter((m) => !m.handledAt);

  /* ---------------- Nepřipojeno ---------------- */

  if (!account) {
    return (
      <div className={styles.wrap}>
        <header className={styles.head}>
          <div>
            <h1 className={styles.h1}>Pošta</h1>
            <p className={styles.sub}>Zatím nepřipojeno</p>
          </div>
        </header>

        {hlaska && <p className={styles.error} role="alert">{hlaska}</p>}

        <section className={styles.empty}>
          <strong>Připoj Gmail a uvidíš, co čeká na odpověď</strong>
          <p>
            Appka si vezme <b>jen právo číst</b>. Nikdy nic neodešle, nesmaže ani neupraví.
            Pro přehled čte jen hlavičky zpráv, tedy od koho, s jakým předmětem a kdy přišly.
            Text zprávy se nikam neukládá.
          </p>
          <p>
            Podle adresy odesílatele pozná klienta a podle toho, kdo psal ve vlákně poslední,
            pozná, že se čeká na tebe. Když budeš chtít, umí z e-mailu pomocí AI navrhnout úkol,
            poptávku nebo odpověď — jen u zprávy, na kterou klikneš, a až to sám povolíš.
          </p>

          {configured ? (
            <>
              <a href="/api/gmail/start" className="btn btn-primary btn-lg">Připojit Gmail</a>
              <p className={styles.note}>
                Google ukáže varování, že appku neověřil. Je to tvoje vlastní aplikace —
                klikni na <b>Upřesnit</b> a pak na <b>Přejít na Studio Deník</b>.
              </p>
            </>
          ) : (
            <p className={styles.note}>
              Na serveru zatím chybí klíče ke Gmailu (<code>GOOGLE_CLIENT_ID</code>,{" "}
              <code>GOOGLE_CLIENT_SECRET</code> a <code>MAIL_TOKEN_KEY</code>).
            </p>
          )}
        </section>

        <p className={styles.legal}>
          Co přesně se zpracovává, popisují <a href="/soukromi">zásady ochrany soukromí</a>.
        </p>
      </div>
    );
  }

  /* ---------------- Připojeno ---------------- */

  const aiPovolena = Boolean(account.aiConsentAt);
  const zaneprazdnen = pending || ukol.pending || odpoved.pending;

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.h1}>Pošta</h1>
          <p className={styles.sub}>
            {account.email}
            {account.lastSyncAt ? ` · načteno ${kdy(account.lastSyncAt)}` : " · zatím nenačteno"}
          </p>
        </div>
        <div className={styles.tools}>
          <button type="button" className="btn" onClick={() => setNastaveni(!nastaveni)}>
            Nastavení
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending}
            onClick={() => run(syncMailAction, (r) => `Načteno ${r.count ?? 0} ${plural(r.count ?? 0, "zpráva", "zprávy", "zpráv")}.`)}
          >
            {pending ? "Načítám…" : "Obnovit"}
          </button>
        </div>
      </header>

      {hlaska && <p className={styles.error} role="alert">{hlaska}</p>}
      {uspech && <p className={styles.ok} role="status">{uspech}</p>}

      {nastaveni && (
        <section className={`panel ${styles.settings}`}>
          <h2>Nastavení schránky</h2>
          <p className={styles.note}>
            Pošta se načítá za posledních 7 dní z doručené pošty, bez záložek Reklamy a Sociální sítě.
            Odpovídá se vždycky v Gmailu — appka umí jen číst.
          </p>

          {aiAvailable && (
            <>
              <h3 className={styles.sub3}>Pomoc AI s e-mailem</h3>
              {aiPovolena ? (
                <>
                  <p className={styles.note}>
                    Zapnuto{aiSince ? ` od ${aiSince}` : ""}. Když u zprávy klikneš na „Udělat úkol“ nebo
                    „Návrh odpovědi“, její text se pošle do služby Google Gemini a ta z něj navrhne úkol,
                    poptávku nebo odpověď. Text zprávy se neukládá.
                  </p>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={zaneprazdnen}
                    onClick={() => run(() => setMailAiConsentAction(false), () => "Pomoc AI s e-mailem je vypnutá.")}
                  >
                    Vypnout
                  </button>
                </>
              ) : (
                <>
                  <p className={styles.note}>
                    Vypnuto — „Udělat úkol“ i „Návrh odpovědi“ se nejdřív zeptají. Zapnutím dovolíš, aby
                    se text zprávy, u které na tlačítko klikneš, poslal do služby Google Gemini a ta
                    z něj navrhla úkol, poptávku nebo odpověď. Text zprávy se neukládá a nic se neděje
                    samo ani hromadně.
                  </p>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={zaneprazdnen}
                    onClick={() => run(() => setMailAiConsentAction(true), () => "Pomoc AI s e-mailem je zapnutá.")}
                  >
                    Zapnout
                  </button>
                </>
              )}
            </>
          )}

          {ignored.length > 0 && (
            <>
              <h3 className={styles.sub3}>Ignorovaní odesílatelé</h3>
              <ul className={styles.ignoredList}>
                {ignored.map((i) => (
                  <li key={i.id}>
                    <code>{i.pattern}</code>
                    <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={() => run(() => unignoreAction(i.id))}>
                      Vrátit
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className={styles.disconnect}>
            {odpojit ? (
              <>
                <p className={styles.warn}>
                  Odpojením se smaže uložené přihlášení i všechny stažené zprávy a Googlu se
                  odebere přístup. V Gmailu se nic nezmění.
                </p>
                <div className={styles.row}>
                  <button type="button" className={`btn btn-sm ${styles.danger}`} disabled={pending} onClick={() => run(disconnectMailAction)}>
                    Opravdu odpojit
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOdpojit(false)}>Nechat</button>
                </div>
              </>
            ) : (
              <button type="button" className="btn btn-sm" onClick={() => setOdpojit(true)}>Odpojit Gmail</button>
            )}
          </div>
        </section>
      )}

      <div className={styles.filters}>
        {([
          ["waiting", "Čeká na odpověď", ceka.length],
          ["all", "Vše", messages.filter((m) => !m.handledAt).length],
          ["handled", "Vyřízené", vyrizene.length],
        ] as const).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            className={`${styles.chip} ${filtr === key ? styles.chipOn : ""}`}
            onClick={() => setFiltr(key)}
          >
            {label}
            <span className={styles.chipCount}>{count}</span>
          </button>
        ))}
      </div>

      {videt.length === 0 ? (
        <p className={styles.blank}>
          {messages.length === 0
            ? "Zatím tu nic není. Klikni na Obnovit."
            : filtr === "waiting"
              ? "Nic nečeká na odpověď."
              : "Tady nic není."}
        </p>
      ) : (
        <ul className={styles.list}>
          {videt.map((m) => (
            <li key={m.id} className={`${styles.item} ${m.handledAt ? styles.itemDone : ""}`}>
              <div className={styles.itemMain}>
                <span className={styles.from}>
                  {m.fromName ?? m.fromEmail}
                  {m.status === "waiting" && !m.handledAt && <em className={styles.tagWaiting}>čeká na odpověď</em>}
                  {m.clientName && <em className={styles.tagClient}>{m.clientName}</em>}
                </span>
                <span className={styles.subject}>{m.subject ?? "(bez předmětu)"}</span>
                <span className={styles.meta}>{m.fromEmail} · {kdy(m.receivedAt)}</span>
              </div>

              <div className={styles.actions}>
                <a
                  className="btn btn-sm"
                  href={gmailThreadUrl(m.threadId)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Otevřít
                </a>
                {!m.handledAt && !m.taskId && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={zaneprazdnen}
                    title={aiAvailable ? "Navrhne úkol z obsahu e-mailu" : undefined}
                    // S AI se otevře okno s návrhem; bez ní se úkol založí rovnou z předmětu.
                    onClick={() => (aiAvailable ? ukol.open(m, aiPovolena) : run(() => taskFromMailAction(m.id)))}
                  >
                    Udělat úkol
                  </button>
                )}
                {m.taskId && <span className={styles.tagTask}>úkol založen</span>}
                {aiAvailable && !m.handledAt && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={zaneprazdnen}
                    title="AI napíše koncept odpovědi, odešleš ho sám v Gmailu"
                    onClick={() => odpoved.open(m, aiPovolena)}
                  >
                    Návrh odpovědi
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={zaneprazdnen}
                  onClick={() => run(() => setHandledAction(m.id, !m.handledAt))}
                >
                  {m.handledAt ? "Vrátit" : "Vyřízeno"}
                </button>
                {!m.handledAt && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={zaneprazdnen}
                    title={`Zprávy od ${m.fromEmail} se už nebudou ukazovat`}
                    onClick={() => run(() => ignoreSenderAction(m.fromEmail))}
                  >
                    Ignorovat
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <MailTaskDialog task={ukol} clients={clients} categories={categories} today={today} />
      <MailReplyDialog reply={odpoved} />
    </div>
  );
}
