import dialog from "../ukoly/tasks.module.css";
import styles from "./posta.module.css";

/**
 * Co se s e-mailem stane, když člověk pomoc AI povolí. Stejný text ve všech
 * oknech, kde AI čte zprávu — souhlas je jeden a platí pro návrh úkolu,
 * poptávky i odpovědi. Musí odpovídat stránce `/soukromi`.
 *
 * `lead` je začátek první věty podle toho, odkud se okno otevřelo
 * („Aby šel z e-mailu navrhnout úkol,“).
 */
export default function AiConsent({ lead }: { lead: string }) {
  return (
    <>
      <p className={styles.consentLead}>
        {lead} pošle se <b>text téhle jedné zprávy</b> ke zpracování do služby Google Gemini:
        odesílatel, předmět, datum a text. Přílohy ne — jejich čtení se zapíná zvlášť
        v Nastavení pošty.
      </p>
      <ul className={styles.consentList}>
        <li>
          Děje se to jen na tvoje kliknutí u konkrétní zprávy. Samo se nic neposílá — ledaže si
          v Nastavení pošty zvlášť zapneš automatické třídění.
        </li>
        <li>
          Text zprávy se nikam neukládá. Uloží se až úkol nebo poptávka, které potvrdíš;
          návrh odpovědi se neukládá vůbec.
        </li>
        <li>Google zaslaný obsah podle podmínek služby nepoužívá k vylepšování svých produktů ani k trénování modelů.</li>
        <li>
          Povolení platí pro návrh úkolu, poptávky i odpovědi u všech dalších zpráv a jde kdykoli
          vypnout v Nastavení pošty.
        </li>
      </ul>
      <p className={dialog.note}>
        Podrobnosti jsou v{" "}
        <a href="/soukromi" target="_blank" rel="noopener noreferrer">zásadách ochrany soukromí</a>.
      </p>
    </>
  );
}
