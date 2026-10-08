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
 *
 * Kdykoli se změní, co appka z Gmailu čte, ukládá nebo komu to předává
 * (`lib/gmail.ts`, `lib/mail-data.ts`), musí se změnit i tahle stránka —
 * a nasadit nejpozději zároveň s tou změnou.
 */
export default function SoukromiPage() {
  return (
    <main className={styles.stage}>
      <article className={styles.page}>
        <Link href="/prihlaseni" className={styles.back}>← Studio Deník</Link>

        <h1 className={styles.h1}>Zásady ochrany soukromí</h1>
        <p className={styles.meta}>Studio Deník · poslední změna 8. října 2026</p>

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
            Pro přehled pošty aplikace čte jen hlavičky zpráv: odesílatele, předmět a datum.
            Odpověď Gmailu obsahuje i krátký úryvek zprávy; aplikace ho nepoužívá a neukládá.
          </li>
          <li>
            Čte se doručená pošta. V nastavení si můžeš vybrat štítky, ze kterých se čte taky —
            pro případ, že ti Gmail poštu přesouvá mimo doručenou — a doručenou poštu můžeš
            z načítání vyřadit, takže se pak čtou jen vybrané štítky. Kvůli tomu výběru aplikace
            načte seznam názvů tvých štítků; uloží jen názvy a identifikátory těch, které vybereš,
            a klienta, kterého ke štítku přiřadíš.
          </li>
          <li>
            Pošta se načítá ve chvíli, kdy v aplikaci klikneš na „Obnovit“. Pokud si zvlášť zapneš
            ranní načítání, načte ji aplikace také sama v úterý, ve středu a ve čtvrtek ráno,
            i když ji nemáš otevřenou — čte přitom totéž, tedy hlavičky zpráv. V ostatní dny a bez
            zapnutého ranního načítání se sama nenačítá.
          </li>
          <li>
            Text zprávy aplikace načte jen u jedné konkrétní zprávy, a to ve chvíli, kdy u ní sám
            klikneš na „Úkol“ nebo „Odpověď“ a máš zapnutou pomoc umělé inteligence
            (viz níže). Pokud si navíc zapneš automatické třídění, načte při načtení pošty i text
            nových zpráv, které čekají na tvou odpověď.
          </li>
          <li>
            Přílohy aplikace načte jen tehdy, když si jejich čtení zvlášť zapneš, a jen u té jedné
            zprávy, u které klikneš na „Úkol“ nebo „Odpověď“. Bez toho je nečte
            nikdy, a automatické třídění je nečte ani potom.
          </li>
          <li>
            Aplikace <strong>nikdy nic neodesílá, nemaže ani neupravuje</strong> a nevytváří koncepty.
          </li>
          <li>
            Data z Gmailu slouží jen k tomu, co v aplikaci vidíš: přehled zpráv, které čekají na
            odpověď, jejich seřazení podle naléhavosti, přiřazení zpráv ke klientům a návrh úkolu,
            poptávky nebo odpovědi ze zprávy.
          </li>
        </ul>

        <h2>Co se ukládá</h2>
        <p>
          U každé zprávy se ukládá odesílatel, předmět, datum přijetí, stav (čeká na odpověď,
          vyřízeno), identifikátor zprávy a vlákna (kvůli odkazu do Gmailu) a klient, ke kterému
          zpráva patří. U schránky se ukládají názvy štítků, které sis vybral k načítání. <strong>Text zprávy ani její přílohy se neukládají</strong> — ani tehdy,
          když ti s ní pomáhá umělá inteligence. Uloží se až úkol nebo poptávka, které sám potvrdíš: název, krátké
          shrnutí a kontaktní údaje odesílatele (jméno a adresa, u poptávky i firma a telefon,
          pokud je uvedl). Všechno můžeš před uložením přepsat. Návrh odpovědi se neukládá vůbec.
          Je-li zapnuté automatické třídění, ukládá se u zprávy i její zařazení (spěchá, čeká na
          odpověď, jen pro informaci) a shrnutí jednou větou; vypnutím třídění se obojí smaže.
          Přihlašovací token ke Gmailu se ukládá šifrovaně a je přístupný jen serveru aplikace,
          nikdy prohlížeči.
        </p>

        <h2>Data z Gmailu a umělá inteligence</h2>
        <p>
          <strong>Ve výchozím stavu se z Gmailu do žádné služby umělé inteligence neposílá nic.</strong>{" "}
          Pošta se třídí pevnými pravidly přímo v aplikaci: podle adresy odesílatele se přiřadí
          klient a podle toho, kdo poslal poslední zprávu ve vlákně, se pozná, že se čeká na tvou
          odpověď.
        </p>
        <p>
          Pomoc umělé inteligence s e-mailem je volitelná funkce. Majitel schránky ji musí
          výslovně povolit a může ji kdykoli vypnout v nastavení pošty. Je-li zapnutá a klikneš
          u zprávy na „Úkol“ nebo „Odpověď“, odešle se odesílatel, předmět, datum
          a text <strong>této jedné zprávy</strong> (bez příloh) ke zpracování službě Google Gemini
          API, která vrátí návrh úkolu, záznamu poptávky nebo odpovědi. U návrhu odpovědi se odešle
          i to, co do okna sám napíšeš jako pokyn. Děje se to jen na tvoje kliknutí. Úkol nebo
          poptávka vzniknou až po tvém potvrzení; odpověď aplikace neodesílá — zkopíruješ si ji
          do Gmailu sám.
        </p>
        <p>
          Čtení příloh je další volitelná funkce a zapíná se zvlášť. Je-li zapnutá a klikneš
          u zprávy na „Úkol“ nebo „Odpověď“, odešlou se službě Google Gemini API
          spolu s textem i přílohy <strong>této jedné zprávy</strong> — jen soubory PDF a obrázky,
          nejvýš čtyři, každý do 5 MB. Jiné typy souborů se neodesílají. Přílohy se nikam
          neukládají; do úkolu nebo poptávky se z nich dostane jen to, co sám potvrdíš. Bez
          zapnutého čtení příloh se neodesílá žádná.
        </p>
        <p>
          Automatické třídění podle priority je další volitelná funkce a zapíná se zvlášť. Je-li
          zapnutá, odešle se při každém načtení pošty (tedy i při ranním, pokud ho máš zapnuté)
          odesílatel, předmět, datum a text každé
          nové zprávy, která čeká na tvou odpověď (bez příloh), službě Google Gemini API. Ta vrátí
          zařazení a shrnutí jednou větou, které se uloží a ukážou v přehledu pošty. Každá zpráva
          se takhle zpracuje jednou. Vypnutím se uložená zařazení i shrnutí smažou. Bez zapnutého
          třídění se samo neposílá nic.
        </p>
        <p>
          Službu Gemini API používáme v placeném režimu, ve kterém Google podle svých podmínek
          zaslaný obsah nepoužívá k vylepšování svých produktů ani k trénování modelů; krátkodobě
          ho uchovává jen kvůli odhalování zneužití a plnění zákonných povinností.{" "}
          <strong>
            Data z Gmailu nepoužíváme k vývoji, trénování ani vylepšování žádných modelů umělé
            inteligence.
          </strong>{" "}
          Provozovatel aplikace zprávy nečte; uložené údaje o zprávách vidí v aplikaci jen majitel
          schránky.
        </p>
        <p>
          Stejnou službu aplikace využívá i pro texty, které do ní sám napíšeš: shrnutí týdenního
          reportu a převod vlastních poznámek na úkoly.
        </p>

        <h2>Komu se data předávají</h2>
        <ul>
          <li>Supabase (databáze) a Vercel (hosting): provoz aplikace.</li>
          <li>
            Google (Gemini API): zpracování textu — a se zvláštním souhlasem i příloh — při návrhu
            úkolu, poptávky nebo odpovědi ze zprávy, zpracování textu při třídění pošty, shrnutí
            reportu a převodu poznámek na úkoly — jen v rozsahu popsaném výše.
          </li>
          <li>
            Data neprodáváme, nepoužíváme k reklamě a kromě uvedených poskytovatelů je nikomu
            nepředáváme.
          </li>
        </ul>

        <h2>Pravidla Googlu pro data uživatelů</h2>
        <p>
          Použití informací získaných z rozhraní Google Workspace se řídí zásadami{" "}
          <a
            href="https://developers.google.com/workspace/workspace-api-user-data-developer-policy"
            rel="noopener noreferrer"
          >
            Google User Data Policy
          </a>
          , včetně požadavků na omezené použití (Limited Use).
        </p>

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
          Gmail, it requests the read-only scope <code>gmail.readonly</code>. For the mail overview
          it reads only message headers (sender, subject, date) of the inbox and, if the mailbox
          owner selects Gmail labels, of messages carrying those labels (the owner may also exclude
          the inbox, so that only the selected labels are read); to offer that choice it reads
          the list of the user’s label names and stores only the names and IDs of the selected ones,
          together with the client the user assigns to a label.
          Mail is loaded when the user clicks
          “Refresh”; if the mailbox owner separately enables scheduled loading, the app also loads
          the headers on its own on Tuesday, Wednesday and Thursday mornings. It never sends, deletes
          or modifies mail. It stores sender, subject, date, a status label, message/thread IDs and the matching
          client, but never the message text or attachments. The Gmail access token is stored
          encrypted and is only available to the server.
        </p>
        <p lang="en">
          <strong>By default, no Gmail data is sent to any artificial intelligence service.</strong>{" "}
          Triage is done by fixed rules inside the application. An optional feature, which the
          mailbox owner must explicitly enable and can turn off at any time, lets the user click
          “Task” or “Reply” on a single message: the sender, subject, date and text of
          that one message, plus any instruction the user types for the reply, are then sent to the
          Google Gemini API to propose a task, a sales-lead record or a reply draft. Attachments are
          not included unless the mailbox owner has separately enabled attachment reading; in that
          case the PDF and image attachments of that one message (at most four files, up to 5 MB
          each) are sent along with its text. Attachments are never stored. A task or lead (a title, a short summary and the sender’s contact details, all
          editable beforehand) is created only after the user confirms it. A reply draft is never
          sent or stored by the app; the user copies it into Gmail. These features run only on the
          user’s click, and the message text is not stored. A second optional feature, enabled
          separately, sorts mail by priority: on each mail load (manual or scheduled), the sender, subject, date and
          text of each new message awaiting the user’s reply (never attachments) are sent to the
          Google Gemini API, which returns a priority label and a one-sentence summary. Only the
          label and the summary are stored, never the message text, and turning the feature off
          deletes them. Unless this feature is enabled, nothing is sent automatically. The Gemini API is used as a
          paid service, under whose terms Google does not use the submitted content to improve its
          products or train models.{" "}
          <strong>
            Gmail data is never used to develop, train or improve any AI/ML model.
          </strong>{" "}
          No human reads the messages other than the mailbox owner. The same service is used for
          text the user writes themselves (weekly report summaries and turning personal notes into
          tasks). Data is not sold or used for advertising. Disconnecting Gmail in the app deletes
          the token and all stored messages and revokes access at Google.
        </p>
        <p lang="en">
          The use of information received from Google Workspace scopes will adhere to the{" "}
          <a
            href="https://developers.google.com/workspace/workspace-api-user-data-developer-policy"
            rel="noopener noreferrer"
          >
            Google User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
      </article>
    </main>
  );
}
