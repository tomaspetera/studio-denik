import type { Metadata } from "next";
import Link from "next/link";
import styles from "./soukromi.module.css";

export const metadata: Metadata = {
  title: "Zásady ochrany soukromí — Studio Deník",
  description: "Jaká data Studio Deník zpracovává, komu je předává a jak je smazat.",
};

/**
 * Veřejná stránka — musí být dostupná bez přihlášení (viz `proxy.ts`).
 * Google ji vyžaduje u každé aplikace, která žádá o přístup ke Gmailu,
 * a text musí odpovídat tomu, co appka doopravdy dělá.
 */
export default function SoukromiPage() {
  return (
    <main className={styles.stage}>
      <article className={styles.page}>
        <Link href="/prihlaseni" className={styles.back}>← Studio Deník</Link>

        <h1 className={styles.h1}>Zásady ochrany soukromí</h1>
        <p className={styles.meta}>Studio Deník · poslední změna 2. října 2026</p>

        <h2>Co je Studio Deník</h2>
        <p>
          Soukromý pracovní nástroj malého grafického studia: úkoly, klienti, termíny, poptávky
          a týdenní reporty. Aplikaci provozuje jedno studio pro vlastní práci, není určená
          veřejnosti.
        </p>

        <h2>Jaká data zpracováváme</h2>
        <ul>
          <li>E-mailovou adresu, kterou se přihlašuješ.</li>
          <li>Pracovní data, která do aplikace sám zapíšeš: úkoly, klienty, kontakty, poznámky a poptávky.</li>
          <li>Pokud připojíš Gmail, údaje popsané níže.</li>
        </ul>

        <h2>Připojení Gmailu (volitelné)</h2>
        <ul>
          <li>
            Žádáme jediné oprávnění, <code>gmail.readonly</code>, tedy <strong>jen čtení</strong>.
          </li>
          <li>
            Aplikace čte hlavičky zpráv (odesílatel, předmět, datum), štítky a krátký úryvek.
            Celé zprávy ani přílohy nečte.
          </li>
          <li>
            Aplikace <strong>nikdy nic neodesílá, nemaže ani neupravuje</strong> a nevytváří koncepty.
          </li>
          <li>
            Zprávy se čtou jen proto, aby aplikace ukázala přehled pošty: roztřídění podle
            naléhavosti a přiřazení ke klientům.
          </li>
        </ul>

        <h2>Co se ukládá</h2>
        <p>
          U každé zprávy se ukládá odesílatel, předmět, datum přijetí, štítek stavu, identifikátor
          zprávy a vlákna (kvůli odkazu do Gmailu) a klient, ke kterému zpráva patří.{" "}
          <strong>Text zprávy ani úryvek se neukládají.</strong> Přihlašovací token ke Gmailu se
          ukládá šifrovaně a je přístupný jen serveru aplikace, nikdy prohlížeči.
        </p>

        <h2>Data z Gmailu a umělá inteligence</h2>
        <p>
          <strong>
            Data z Gmailu se neodesílají do žádné služby umělé inteligence a nepoužívají se
            k trénování ani vylepšování žádných modelů.
          </strong>{" "}
          Pošta se třídí pevnými pravidly přímo v aplikaci: podle adresy odesílatele se přiřadí
          klient a podle toho, kdo poslal poslední zprávu ve vlákně, se pozná, že se čeká na tvou
          odpověď.
        </p>
        <p>
          Aplikace umí využít službu Google Gemini API, ale výhradně pro texty, které do ní sám
          napíšeš (shrnutí týdenního reportu a převod vlastních poznámek na úkoly). Obsah
          z Gmailu do ní nevstupuje.
        </p>

        <h2>Komu se data předávají</h2>
        <ul>
          <li>Supabase (databáze) a Vercel (hosting): provoz aplikace.</li>
          <li>
            Data neprodáváme, nepoužíváme k reklamě a kromě uvedených poskytovatelů je nikomu
            nepředáváme.
          </li>
        </ul>

        <h2>Odpojení a smazání</h2>
        <p>
          Tlačítko „Odpojit Gmail“ v aplikaci smaže uložený token i všechny stažené zprávy a zruší
          přístup u Googlu. Přístup lze kdykoli zrušit také v nastavení Google účtu na{" "}
          <a href="https://myaccount.google.com/permissions" rel="noopener noreferrer">
            myaccount.google.com/permissions
          </a>
          . Smazání celého účtu a všech dat je možné na žádost.
        </p>

        <h2>Kontakt</h2>
        <p>
          Dotazy k ochraně údajů pošli na e-mail uvedený jako kontakt na souhlasové obrazovce
          Google při připojování Gmailu.
        </p>

        <h2 lang="en">Summary in English</h2>
        <p lang="en">
          Studio Deník is a private work tool for a small graphic design studio. If you connect
          Gmail, it requests the read-only scope <code>gmail.readonly</code> and reads only message
          headers (sender, subject, date), labels and a short snippet. It never sends, deletes or
          modifies mail. It stores sender, subject, date, a status label, message/thread IDs and the
          matching client, but not message text or snippets. The Gmail access token is stored
          encrypted and is only available to the server.{" "}
          <strong>
            Gmail data is never sent to any artificial intelligence service and is never used to
            develop, train or improve any AI/ML model.
          </strong>{" "}
          Triage is done by fixed rules inside the application. The app can use the Google Gemini
          API, but only for text the user writes themselves (weekly report summaries and turning
          personal notes into tasks); no Gmail content is included. Data is not sold or used for
          advertising. Disconnecting Gmail in the app deletes the token and all stored messages and
          revokes access at Google.
        </p>
      </article>
    </main>
  );
}
