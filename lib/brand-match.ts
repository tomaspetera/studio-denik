/**
 * Značky jako klienti — čistá logika bez databáze a bez AI.
 *
 * Kdo dělá pro jednu firmu víc značek, má je nejdřív jen v názvech úkolů
 * („Banner pro METSTRADE“) a všechno pod jedním klientem. Jakmile značky
 * založí jako klienty, appka umí dvě věci:
 *
 *  1. ze štítku v Gmailu navrhnout jméno klienta a založit ho (`labelClientName`,
 *     `planLabelClients`);
 *  2. najít úkoly, které mají jméno klienta v názvu a patří jinam, a nabídnout
 *     jejich přeřazení (`suggestMoves`). Nic se nepřeřazuje samo.
 */

export type BrandClient = { id: string; name: string };

/** Malá písmena bez háčků a čárek — „Tiskárna“ a „tiskarna“ je totéž slovo. */
export function normalizeName(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Obecná slova a přípony firem — podle nich se značka nepozná. */
const BEZ_VYZNAMU = new Set(["s", "r", "o", "sro", "a", "as", "spol", "ltd", "inc", "gmbh", "se", "co", "the", "europe", "czech", "cz"]);

/**
 * Slova jména, podle kterých má smysl hledat — bez obecných. Jednoslovné
 * jméno kratší než tři znaky se nehledá vůbec: sedělo by skoro na všechno.
 */
function slova(text: string): string[] {
  const vse = normalizeName(text)
    .split(/[^a-z0-9]+/)
    .filter((s) => s.length > 0 && !BEZ_VYZNAMU.has(s));
  return vse.length === 1 && vse[0].length < 3 ? [] : vse;
}

/**
 * Jméno klienta ze štítku: poslední část („Ultra_Marine/MRL“ → „MRL“),
 * podtržítka jako mezery.
 */
export function labelClientName(labelName: string): string {
  const posledni = labelName.split("/").pop() ?? labelName;
  return posledni.replace(/_/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export type LabelClientPlan = {
  /** Klienti, které je potřeba založit: jméno a barva. */
  create: { labelId: string; name: string; color: string }[];
  /** Štítky, pro které už klient se stejným jménem existuje. */
  reuse: Record<string, string>;
};

/**
 * Co založit pro vybrané štítky. Klient se stejným jménem (bez ohledu na
 * velikost písmen a háčky) se nezakládá podruhé — použije se ten stávající.
 * Barvy se berou z palety tak, aby se neopakovaly, dokud je z čeho brát.
 */
export function planLabelClients(
  labels: { id: string; name: string }[],
  existing: (BrandClient & { color: string })[],
  palette: readonly string[],
): LabelClientPlan {
  const create: LabelClientPlan["create"] = [];
  const reuse: Record<string, string> = {};
  const pouzite = new Set(existing.map((c) => c.color.toLowerCase()));
  const podleJmena = new Map(existing.map((c) => [normalizeName(c.name).trim(), c.id]));

  for (const l of labels) {
    const name = labelClientName(l.name);
    if (!name) continue;
    const klic = normalizeName(name);
    const stavajici = podleJmena.get(klic);
    if (stavajici) {
      reuse[l.id] = stavajici;
      continue;
    }
    // Dva štítky se stejným posledním jménem založí klienta jen jednou.
    const uzVPlanu = create.find((c) => normalizeName(c.name) === klic);
    if (uzVPlanu) continue;

    const color = palette.find((c) => !pouzite.has(c.toLowerCase())) ?? palette[create.length % Math.max(1, palette.length)] ?? "#6B7B80";
    pouzite.add(color.toLowerCase());
    create.push({ labelId: l.id, name, color });
  }
  return { create, reuse };
}

/**
 * Kterému klientovi úkol podle názvu patří. Jméno klienta musí být v názvu
 * celé, po slovech a ve stejném pořadí („MR LETTER“ sedí na „pro MR.LETTER“,
 * „UME“ nesedí na „dokument“). Když sedí víc klientů, vyhrává delší jméno;
 * při shodě se nehádá.
 */
export function matchBrand(title: string, clients: BrandClient[]): string | null {
  const vNazvu = ` ${normalizeName(title).split(/[^a-z0-9]+/).filter(Boolean).join(" ")} `;
  let nej: { id: string; delka: number } | null = null;
  let shoda = false;

  for (const c of clients) {
    const hledane = slova(c.name);
    if (hledane.length === 0) continue;
    const fraze = ` ${hledane.join(" ")} `;
    // Jméno musí být v názvu jako souvislá fráze z celých slov.
    if (!vNazvu.includes(fraze)) continue;
    const delka = fraze.length;
    if (!nej || delka > nej.delka) {
      nej = { id: c.id, delka };
      shoda = false;
    } else if (delka === nej.delka && c.id !== nej.id) {
      shoda = true;
    }
  }
  return nej && !shoda ? nej.id : null;
}

export type MoveSuggestion = { clientId: string; tasks: { id: string; title: string }[] };

/**
 * Úkoly, které mají jméno klienta v názvu, ale patří jinému klientovi nebo
 * žádnému. Vrací se po klientech, jen neprázdné.
 */
export function suggestMoves(
  tasks: { id: string; title: string; client_id: string | null }[],
  clients: BrandClient[],
): MoveSuggestion[] {
  const podleKlienta = new Map<string, { id: string; title: string }[]>();
  for (const t of tasks) {
    const komu = matchBrand(t.title, clients);
    if (!komu || komu === t.client_id) continue;
    podleKlienta.set(komu, [...(podleKlienta.get(komu) ?? []), { id: t.id, title: t.title }]);
  }
  return [...podleKlienta].map(([clientId, seznam]) => ({ clientId, tasks: seznam }));
}
