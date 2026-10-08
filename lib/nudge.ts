import { daysBetweenKeys, type DateKey } from "./domain.ts";

/**
 * Urgování klienta — čistá logika bez databáze a bez AI.
 *
 * Úkol „u klienta“ je z pohledu studia hotový, ale neuzavřený: čeká se na
 * schválení. Appka u něj ukazuje, jak dlouho tam leží, a připraví text
 * připomínky. Neposílá nic — text si člověk zkopíruje a pošle sám.
 */

/** Od kolika dní čekání je to vidět červeně. */
export const WAIT_LONG_DAYS = 7;

/** Den bez roku — „5. 10.“. */
function den(key: DateKey): string {
  const [, m, d] = key.split("-").map(Number);
  return `${d}. ${m}.`;
}

/** Jak dlouho úkol leží jinde, slovy: „od dneška“, „od včera“, „5 dní“. */
export function waitLabel(days: number): string {
  if (days <= 0) return "od dneška";
  if (days === 1) return "od včera";
  return `${days} ${days >= 5 ? "dní" : "dny"}`;
}

/** Kdy se naposledy urgovalo: „urgováno dnes“, „urgováno včera“, „urgováno 3. 10.“. */
export function nudgedLabel(nudgedKey: DateKey, today: DateKey): string {
  const pred = daysBetweenKeys(nudgedKey, today);
  if (pred <= 0) return "urgováno dnes";
  if (pred === 1) return "urgováno včera";
  return `urgováno ${den(nudgedKey)}`;
}

export type NudgeInput = {
  title: string;
  /** Od kdy úkol u klienta leží; `null`, když se to neví. */
  sinceKey: DateKey | null;
  dueKey: DateKey | null;
  today: DateKey;
  /** Jméno do podpisu; bez něj zůstane místo k doplnění. */
  name: string | null;
};

/**
 * Text připomínky. Záměrně krátký a bez výčitek: říká, co čeká, od kdy,
 * a že stačí krátká odpověď. Psaný tak, aby seděl, ať ho posílá kdokoli.
 */
export function nudgeText(input: NudgeInput): { subject: string; body: string } {
  const nazev = input.title.replace(/\s+/g, " ").trim();
  const odKdy = input.sinceKey && daysBetweenKeys(input.sinceKey, input.today) >= 1 ? ` od ${den(input.sinceKey)}` : "";

  const radky = [
    "Dobrý den,",
    "",
    `připomínám „${nazev}“ —${odKdy} čeká na vaše schválení.`,
    "",
    "Stačí krátká odpověď: jestli je to takhle v pořádku, nebo co mám upravit.",
  ];

  if (input.dueKey) {
    const zbyva = daysBetweenKeys(input.today, input.dueKey);
    if (zbyva < 0) radky.push(`Termín byl ${den(input.dueKey)}, proto se ozývám.`);
    else if (zbyva === 0) radky.push("Termín je dnes, proto se ozývám.");
    else radky.push(`Termín je ${den(input.dueKey)} — aby se stihl, potřebuji vaši odpověď co nejdřív.`);
  }

  radky.push("", "Děkuji a hezký den", input.name?.trim() || "[podpis]");
  return { subject: `Připomenutí: ${nazev}`, body: radky.join("\n") };
}
