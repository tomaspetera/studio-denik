"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { csDate, plural, type DateKey } from "@/lib/domain";
import type { MailRow } from "@/lib/mail-data";
import { mailBucket, sortWaiting } from "@/lib/mail-buckets";
import { INBOX_ID, LABELS_MAX, clientOfLabel, labelRows, mailSources, sourcesLabel, withChildren, type MailLabel } from "@/lib/mail-labels";
import type { Category, Client } from "@/lib/tasks";
import {
  disconnectMailAction,
  ignoreSenderAction,
  listGmailLabelsAction,
  setHandledAction,
  setMailAiConsentAction,
  setMailAutoSyncAction,
  setMailAutoTriageAction,
  setMailFilesAction,
  setMailLabelsAction,
  setSignatureAction,
  syncMailAction,
  taskFromMailAction,
  unignoreAction,
} from "./actions";
import MailTaskDialog, { useMailTask } from "./MailTaskDialog";
import MailReplyDialog, { gmailThreadUrl, useMailReply } from "./MailReplyDialog";
import styles from "./posta.module.css";

type Filtr = "waiting" | "fyi" | "all" | "handled";

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
  signature,
  clients,
  categories,
  today,
}: {
  configured: boolean;
  account: {
    email: string;
    lastSyncAt: string | null;
    aiConsentAt: string | null;
    aiAutoAt: string | null;
    aiFilesAt: string | null;
    autoSyncAt: string | null;
    labels: MailLabel[];
  } | null;
  messages: MailRow[];
  ignored: { id: string; pattern: string }[];
  justConnected: boolean;
  error: string | null;
  /** Na serveru je klíč ke Gemini, takže AI může s e-mailem pomoct (úkol, poptávka, odpověď). */
  aiAvailable: boolean;
  /** Od kdy je pomoc AI povolená — hotový text, počítaný na serveru podle Prahy. */
  aiSince: string | null;
  /** Jméno z profilu — appka jím podepisuje návrh odpovědi. */
  signature: string | null;
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
  /** Zpráva, u které je otevřená nabídka s méně častými akcemi. */
  const [menu, setMenu] = useState<string | null>(null);
  const [podpis, setPodpis] = useState(signature ?? "");
  /** Výběr štítků v nastavení: `null` = zavřený; jinak štítky z Gmailu a co je zaškrtnuté. */
  const [stitky, setStitky] = useState<{ all: MailLabel[]; picked: string[]; clients: Record<string, string> } | null>(null);
  const [pending, startTransition] = useTransition();

  const ukol = useMailTask((zprava) => {
    setHlaska(null);
    setUspech(zprava);
    router.refresh();
  });
  const odpoved = useMailReply();

  type Vysledek = { ok: boolean; message?: string; count?: number; sorted?: number; note?: string };

  function run(fn: () => Promise<Vysledek>, poUspechu?: (r: Vysledek) => string | null) {
    setHlaska(null);
    setUspech(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setHlaska(res.message ?? "Nepodařilo se to.");
      else if (poUspechu) setUspech(poUspechu(res));
      router.refresh();
    });
  }

  /** Seznam štítků se čte z Gmailu až na kliknutí — a neukládá se, dokud člověk výběr nepotvrdí. */
  function otevriStitky(ulozene: MailLabel[]) {
    setHlaska(null);
    setUspech(null);
    startTransition(async () => {
      const res = await listGmailLabelsAction();
      if (!res.ok) setHlaska(res.message);
      // Štítek, který mezitím v Gmailu zanikl, z výběru vypadne. Doručená pošta
      // je zaškrtnutá, když se zatím čte — tedy i u schránky bez jakéhokoli výběru.
      else {
        setStitky({
          all: res.labels,
          picked: [
            ...(mailSources(ulozene).inbox ? [INBOX_ID] : []),
            ...ulozene.map((l) => l.id).filter((id) => res.labels.some((l) => l.id === id)),
          ],
          // Kterému klientovi který štítek patří — jen u klientů, kteří ve studiu ještě jsou.
          clients: Object.fromEntries(
            ulozene
              .filter((l) => l.clientId && clients.some((c) => c.id === l.clientId))
              .map((l) => [l.id, l.clientId as string]),
          ),
        });
      }
    });
  }

  /** Zaškrtnutí vezme i podštítky (v Gmailu jsou to samostatné štítky); odškrtnutí jen ten jeden. */
  function prepniStitek(id: string) {
    setStitky((s) => {
      if (!s) return s;
      if (s.picked.includes(id)) return { ...s, picked: s.picked.filter((x) => x !== id) };
      // Doručená pošta mezi štítky z Gmailu není — je to zdroj navíc, bez podštítků.
      const pridat = id === INBOX_ID ? [INBOX_ID] : withChildren(s.all, id);
      return { ...s, picked: [...new Set([...s.picked, ...pridat])] };
    });
  }

  // Čeká na odpověď: co spěchá, je nahoře. Zprávy, které po mně nic nechtějí,
  // mají vlastní záložku — nic se neschovává, jen se to nepočítá mezi resty.
  const ceka = sortWaiting(messages.filter((m) => mailBucket(m) === "urgent" || mailBucket(m) === "reply"));
  const proInformaci = messages.filter((m) => mailBucket(m) === "fyi");
  const vyrizene = messages.filter((m) => m.handledAt);
  const videt =
    filtr === "waiting"
      ? ceka
      : filtr === "fyi"
        ? proInformaci
        : filtr === "handled"
          ? vyrizene
          : messages.filter((m) => !m.handledAt);

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
  const tridiSe = aiPovolena && Boolean(account.aiAutoAt);
  const ctePrilohy = aiPovolena && Boolean(account.aiFilesAt);
  // Odkud se pošta načítá: doručená pošta, vybrané štítky, nebo obojí.
  const zdroje = mailSources(account.labels);
  const vybraneStitky = account.labels.filter((l) => l.id !== INBOX_ID);
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
            onClick={() =>
              run(syncMailAction, (r) => {
                const nacteno = `Načteno ${r.count ?? 0} ${plural(r.count ?? 0, "zpráva", "zprávy", "zpráv")}`;
                const trideno = r.sorted
                  ? `, ${r.sorted} ${plural(r.sorted, "nová roztříděná", "nové roztříděné", "nových roztříděných")}`
                  : "";
                return `${nacteno}${trideno}.${r.note ? ` ${r.note}` : ""}`;
              })
            }
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
            Pošta se načítá za posledních 7 dní {sourcesLabel(account.labels)}, bez záložek Reklamy
            a Sociální sítě. Odpovídá se vždycky v Gmailu — appka umí jen číst.
          </p>

          <h3 className={styles.sub3}>Načítání</h3>

          <div className={styles.set}>
            <div className={styles.setHead}>
              <div className={styles.setText}>
                <b>Odkud se pošta načítá</b>
                <span className={styles.setOn}>
                  {vybraneStitky.length === 0
                    ? "jen doručená pošta"
                    : `${zdroje.inbox ? "doručená pošta a štítky" : "jen štítky"}: ${vybraneStitky
                        .map((l) => {
                          const klient = clients.find((c) => c.id === clientOfLabel(account.labels, l))?.name;
                          return klient ? `${l.name} → ${klient}` : l.name;
                        })
                        .join(", ")}`}
                </span>
              </div>
              {!stitky && (
                <button type="button" className="btn btn-sm" disabled={zaneprazdnen} onClick={() => otevriStitky(account.labels)}>
                  Změnit
                </button>
              )}
            </div>
            {stitky && (
              <div className={styles.setBody}>
                <p className={styles.note}>
                  Zaškrtni, odkud se má pošta načítat. Když máš všechnu pracovní poštu ve štítcích, můžeš
                  doručenou poštu odškrtnout — appka pak čte a třídí jen štítky. Podštítek je v Gmailu
                  samostatný štítek: s nadřazeným se zaškrtne taky a jde odškrtnout zvlášť. U štítku
                  můžeš vybrat klienta — pošta z něj se pak označí jako jeho, ať ji poslal kdokoli.
                  Podštítek bez klienta přebírá klienta nadřazeného štítku.
                </p>
                <ul className={styles.labelList}>
                  <li className={styles.labelInbox}>
                    <label>
                      <input type="checkbox" checked={stitky.picked.includes(INBOX_ID)} onChange={() => prepniStitek(INBOX_ID)} />
                      <span>Doručená pošta</span>
                    </label>
                  </li>
                  {labelRows(stitky.all).map((l) => (
                    <li key={l.id} className={styles.labelRow} style={{ paddingLeft: l.depth * 22 }}>
                      <label>
                        <input type="checkbox" checked={stitky.picked.includes(l.id)} onChange={() => prepniStitek(l.id)} />
                        <span>{l.short}</span>
                      </label>
                      {/* Komu pošta z tohohle štítku patří — má přednost před adresou odesílatele. */}
                      {stitky.picked.includes(l.id) && clients.length > 0 && (
                        <select
                          className={`field ${styles.labelClient}`}
                          aria-label={`Klient pro štítek ${l.name}`}
                          value={stitky.clients[l.id] ?? ""}
                          onChange={(e) => {
                            const klient = e.target.value;
                            setStitky((s) => {
                              if (!s) return s;
                              const dalsi = { ...s.clients };
                              if (klient) dalsi[l.id] = klient;
                              else delete dalsi[l.id];
                              return { ...s, clients: dalsi };
                            });
                          }}
                        >
                          {/* Podštítek bez vlastního klienta přebírá klienta nadřazeného štítku. */}
                          <option value="">
                            {stitky.all.some((p) => stitky.picked.includes(p.id) && stitky.clients[p.id] && l.name.startsWith(`${p.name}/`))
                              ? "jako nadřazený štítek"
                              : "klient podle adresy"}
                          </option>
                          {clients.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      )}
                    </li>
                  ))}
                </ul>
                {stitky.all.length === 0 && <p className={styles.note}>V Gmailu nemáš žádné vlastní štítky.</p>}
                {stitky.picked.length === 0 && (
                  <p className={styles.warn}>Vyber aspoň doručenou poštu nebo jeden štítek — jinak by appka neměla co číst.</p>
                )}
                {stitky.picked.length > LABELS_MAX && (
                  <p className={styles.warn}>Najednou jde načítat nejvýš {LABELS_MAX} zdrojů — některé odškrtni.</p>
                )}
                <div className={styles.row}>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={zaneprazdnen || stitky.picked.length === 0 || stitky.picked.length > LABELS_MAX}
                    onClick={() =>
                      run(() => setMailLabelsAction(stitky.picked, stitky.clients), () => {
                        const sDorucenou = stitky.picked.includes(INBOX_ID);
                        const seStitky = stitky.picked.some((id) => id !== INBOX_ID);
                        setStitky(null);
                        return !seStitky
                          ? "Uloženo — načítá se jen doručená pošta. Klikni na Obnovit."
                          : sDorucenou
                            ? "Uloženo — načítá se doručená pošta i vybrané štítky. Klikni na Obnovit."
                            : "Uloženo — načítají se jen vybrané štítky, doručená pošta ne. Klikni na Obnovit.";
                      })
                    }
                  >
                    Uložit výběr
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setStitky(null)}>Zrušit</button>
                </div>
              </div>
            )}
          </div>

          <Setting
            title="Ranní načítání"
            on={Boolean(account.autoSyncAt)}
            state={account.autoSyncAt ? "zapnuto — úterý, středa a čtvrtek ráno" : "vypnuto"}
            action={
              <button
                type="button"
                className="btn btn-sm"
                disabled={zaneprazdnen}
                onClick={() =>
                  account.autoSyncAt
                    ? run(() => setMailAutoSyncAction(false), () => "Ranní načítání pošty je vypnuté.")
                    : run(() => setMailAutoSyncAction(true), () => "Ranní načítání pošty je zapnuté — v úterý, ve středu a ve čtvrtek ráno.")
                }
              >
                {account.autoSyncAt ? "Vypnout" : "Zapnout"}
              </button>
            }
          >
            {account.autoSyncAt ? (
              <p className={styles.note}>
                Každé úterý, středu a čtvrtek ráno appka poštu načte sama, i když ji nemáš otevřenou —
                stejně jako tlačítkem Obnovit. Na stránce Dnes a v ranním upozornění pak vidíš, kolik
                zpráv čeká na odpověď.{tridiSe ? " Nové zprávy přitom rovnou roztřídí." : ""}
              </p>
            ) : (
              <p className={styles.note}>
                Pošta se načítá, jen když klikneš na Obnovit. Zapnutím dovolíš, aby ji appka načetla{" "}
                <b>sama každé úterý, středu a čtvrtek ráno</b>, i když ji nemáš otevřenou. Čte přitom
                totéž co při Obnovit: odesílatele, předmět a datum.
                {tridiSe
                  ? " Protože máš zapnuté automatické třídění, nové zprávy přitom rovnou roztřídí."
                  : " Třídit je bude, jen když si zapneš i automatické třídění."}
              </p>
            )}
          </Setting>

          {aiAvailable && (
            <>
              <h3 className={styles.sub3}>Pomoc AI</h3>

              <Setting
                title="Úkol a odpověď z e-mailu"
                on={aiPovolena}
                state={aiPovolena ? `zapnuto${aiSince ? ` od ${aiSince}` : ""}` : "vypnuto"}
                action={
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={zaneprazdnen}
                    onClick={() =>
                      aiPovolena
                        ? run(() => setMailAiConsentAction(false), () => "Pomoc AI s e-mailem je vypnutá.")
                        : run(() => setMailAiConsentAction(true), () => "Pomoc AI s e-mailem je zapnutá.")
                    }
                  >
                    {aiPovolena ? "Vypnout" : "Zapnout"}
                  </button>
                }
              >
                {aiPovolena ? (
                  <p className={styles.note}>
                    Když u zprávy klikneš na „Úkol“ nebo „Odpověď“, její text se pošle do služby Google
                    Gemini a ta z něj navrhne úkol, poptávku nebo odpověď. Text zprávy se neukládá.
                    Vypnutím se vypne i třídění a čtení příloh.
                  </p>
                ) : (
                  <p className={styles.note}>
                    „Úkol“ i „Odpověď“ se nejdřív zeptají. Zapnutím dovolíš, aby se text zprávy, u které
                    na tlačítko klikneš, poslal do služby Google Gemini a ta z něj navrhla úkol, poptávku
                    nebo odpověď. Text zprávy se neukládá a nic se neděje samo ani hromadně.
                  </p>
                )}
              </Setting>

              {aiPovolena && (
                <>
                  <Setting
                    title="Automatické třídění podle priority"
                    on={tridiSe}
                    state={tridiSe ? "zapnuto" : "vypnuto"}
                    action={
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={zaneprazdnen}
                        onClick={() =>
                          tridiSe
                            ? run(() => setMailAutoTriageAction(false), () => "Automatické třídění je vypnuté, zařazení i shrnutí jsou smazaná.")
                            : run(() => setMailAutoTriageAction(true), () => "Automatické třídění je zapnuté. Klikni na Obnovit a pošta se roztřídí.")
                        }
                      >
                        {tridiSe ? "Vypnout" : "Zapnout"}
                      </button>
                    }
                  >
                    {tridiSe ? (
                      <p className={styles.note}>
                        Při každém načtení pošty se text nových zpráv, které čekají na tvou odpověď, pošle
                        do služby Google Gemini. Ta určí, jestli zpráva spěchá, a jednou větou ji shrne.
                        Ukládá se jen zařazení a shrnutí, text zprávy ne.
                      </p>
                    ) : (
                      <p className={styles.note}>
                        Zapnutím dovolíš, aby se text nových zpráv, které čekají na tvou odpověď, posílal
                        do služby Google Gemini <b>sám při každém načtení pošty</b> — bez kliknutí
                        u jednotlivých zpráv. AI u každé určí, jestli spěchá, čeká na odpověď, nebo je jen
                        pro informaci, a jednou větou ji shrne. Ukládá se jen zařazení a shrnutí; vypnutím
                        se zase smažou.
                      </p>
                    )}
                  </Setting>

                  <Setting
                    title="Čtení příloh"
                    on={ctePrilohy}
                    state={ctePrilohy ? "zapnuto — PDF a obrázky" : "vypnuto"}
                    action={
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={zaneprazdnen}
                        onClick={() =>
                          ctePrilohy
                            ? run(() => setMailFilesAction(false), () => "Čtení příloh je vypnuté.")
                            : run(() => setMailFilesAction(true), () => "Čtení příloh je zapnuté. Platí pro zprávu, u které klikneš na „Úkol“ nebo „Odpověď“.")
                        }
                      >
                        {ctePrilohy ? "Vypnout" : "Zapnout"}
                      </button>
                    }
                  >
                    {ctePrilohy ? (
                      <p className={styles.note}>
                        Když u zprávy klikneš na „Úkol“ nebo „Odpověď“, pošlou se do služby Google Gemini
                        spolu s textem i její přílohy — PDF a obrázky (nejvýš 4 soubory, každý do 5 MB,
                        dohromady asi 20 stran). Nic z nich se neukládá. Automatické třídění přílohy nečte.
                      </p>
                    ) : (
                      <p className={styles.note}>
                        AI čte jen text zprávy. Zapnutím dovolíš, aby se u zprávy, na kterou klikneš,
                        poslaly do služby Google Gemini <b>i její přílohy</b> — PDF a obrázky. V přílohách
                        bývají faktury a smlouvy, proto se to zapíná zvlášť. Nic z nich se neukládá
                        a automatické třídění přílohy nečte nikdy.
                      </p>
                    )}
                  </Setting>
                </>
              )}

              <div className={styles.set}>
                <div className={styles.setHead}>
                  <div className={styles.setText}>
                    <b>Podpis v návrhu odpovědi</b>
                    <span className={styles.setState}>tvoje jméno v appce — vidí ho i kolegové v Týmu</span>
                  </div>
                  <form
                    className={styles.signature}
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(() => setSignatureAction(podpis), () => {
                        // Server ukládá jméno bez mezer navíc — ať pole ukazuje totéž.
                        setPodpis(podpis.replace(/\s+/g, " ").trim());
                        return "Jméno pro podpis je uložené.";
                      });
                    }}
                  >
                    <input
                      className="field"
                      type="text"
                      aria-label="Jméno pro podpis"
                      placeholder="Jméno a příjmení"
                      autoComplete="name"
                      // Stejný strop jako na serveru (`SIGNATURE_MAX` v `lib/mail-reply.ts`).
                      maxLength={80}
                      value={podpis}
                      onChange={(e) => setPodpis(e.target.value)}
                    />
                    <button
                      type="submit"
                      className="btn btn-sm"
                      disabled={zaneprazdnen || podpis.trim().length < 2 || podpis.trim() === (signature ?? "")}
                    >
                      Uložit
                    </button>
                  </form>
                </div>
              </div>
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
          // Záložka dává smysl jen s tříděním — bez něj do ní nic nepadá.
          ...(tridiSe || proInformaci.length > 0 ? ([["fyi", "Jen pro informaci", proInformaci.length]] as const) : []),
          ["all", "Vše", messages.filter((m) => !m.handledAt).length],
          ["handled", "Vyřízené", vyrizene.length],
        ] as const).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            className={`${styles.chip} ${filtr === key ? styles.chipOn : ""}`}
            onClick={() => {
              setFiltr(key);
              setMenu(null);
            }}
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
              : filtr === "fyi"
                ? "Nic, co by bylo jen pro informaci."
                : "Tady nic není."}
        </p>
      ) : (
        <ul className={styles.list}>
          {videt.map((m) => {
            const kam = mailBucket(m);
            return (
              <li key={m.id} className={`${styles.item} ${m.handledAt ? styles.itemDone : ""}`}>
                <div className={styles.itemMain}>
                  {/* Kliknutím na zprávu se otevře v Gmailu — samostatné tlačítko na to není potřeba. */}
                  <a
                    className={styles.open}
                    href={gmailThreadUrl(m.threadId, account.email)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Otevřít v Gmailu"
                  >
                    <span className={styles.from}>
                      {m.fromName ?? m.fromEmail}
                      {kam === "urgent" && <em className={styles.tagUrgent}>spěchá</em>}
                      {/* Stav je vidět už ze záložky — štítek jen tam, kde jsou zprávy pohromadě. */}
                      {filtr === "all" && kam === "reply" && <em className={styles.tagWaiting}>čeká na odpověď</em>}
                      {filtr === "all" && kam === "fyi" && <em className={styles.tagFyi}>jen pro informaci</em>}
                      {m.clientName && <em className={styles.tagClient}>{m.clientName}</em>}
                    </span>
                    <span className={styles.subject}>{m.subject ?? "(bez předmětu)"}</span>
                  </a>
                  {m.summary && <span className={styles.summary}>{m.summary}</span>}
                  <span className={styles.meta}>{m.fromEmail} · {kdy(m.receivedAt)}</span>
                </div>

                <div className={styles.actions}>
                  {!m.handledAt && !m.taskId && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={zaneprazdnen}
                      title={aiAvailable ? "Navrhne úkol z obsahu e-mailu" : "Založí úkol z předmětu e-mailu"}
                      // S AI se otevře okno s návrhem; bez ní se úkol založí rovnou z předmětu.
                      onClick={() => (aiAvailable ? ukol.open(m, aiPovolena) : run(() => taskFromMailAction(m.id)))}
                    >
                      Úkol
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
                      Odpověď
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={zaneprazdnen}
                    onClick={() => run(() => setHandledAction(m.id, !m.handledAt))}
                  >
                    {m.handledAt ? "Vrátit" : "Vyřízeno"}
                  </button>

                  {/* Co se dělá zřídka, je za třemi tečkami. */}
                  <div
                    className={styles.menu}
                    onBlur={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget)) setMenu(null);
                    }}
                  >
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      aria-label="Další možnosti"
                      aria-expanded={menu === m.id}
                      onClick={() => setMenu(menu === m.id ? null : m.id)}
                    >
                      ⋯
                    </button>
                    {menu === m.id && (
                      <div className={styles.menuList} role="menu">
                        <a
                          role="menuitem"
                          href={gmailThreadUrl(m.threadId, account.email)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setMenu(null)}
                        >
                          Otevřít v Gmailu
                        </a>
                        {!m.handledAt && (
                          <button
                            type="button"
                            role="menuitem"
                            disabled={zaneprazdnen}
                            title={`Zprávy od ${m.fromEmail} se už nebudou ukazovat`}
                            onClick={() => {
                              setMenu(null);
                              run(() => ignoreSenderAction(m.fromEmail));
                            }}
                          >
                            Ignorovat odesílatele
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <MailTaskDialog task={ukol} clients={clients} categories={categories} today={today} />
      <MailReplyDialog reply={odpoved} account={account.email} />
    </div>
  );
}

/**
 * Jedno nastavení schránky: název, stav jednou větou a přepínač. Vysvětlení je
 * u zapnutého nastavení sbalené, ať stránka není stěna textu. U vypnutého je
 * vidět rovnou — než člověk něco zapne, má vědět, s čím souhlasí.
 */
function Setting({
  title,
  state,
  on,
  action,
  children,
}: {
  title: string;
  state: string;
  on: boolean;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.set}>
      <div className={styles.setHead}>
        <div className={styles.setText}>
          <b>{title}</b>
          <span className={on ? styles.setOn : styles.setOff}>{state}</span>
        </div>
        {action}
      </div>
      {on ? (
        <details className={styles.setMore}>
          <summary>Co to dělá</summary>
          {children}
        </details>
      ) : (
        <div className={styles.setBody}>{children}</div>
      )}
    </div>
  );
}
