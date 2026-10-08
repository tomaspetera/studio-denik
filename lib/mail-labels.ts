/**
 * Štítky Gmailu, ze kterých se pošta načítá navíc k doručené — čistá logika
 * bez sítě a bez databáze. Bez závislostí, protože ji potřebuje i nastavení
 * v prohlížeči.
 *
 * Appka čte doručenou poštu. Kdo si ale nechá Gmailem zprávy rovnou přesouvat
 * do štítků (filtr „přeskočit doručenou poštu“), v doručené je nemá — a appka
 * by je neviděla. Proto si majitel schránky může vybrat štítky, které se
 * načítají taky. Bez výběru se nenačítá nic navíc.
 *
 * Gmail zná podštítky jen podle jména („Ultra_Marine/MRL“): zprávy
 * z podštítku do nadřazeného štítku nepatří. Kdo chce obojí, musí mít
 * vybrané obojí — nastavení proto s nadřazeným štítkem zaškrtne i podštítky.
 */

export type MailLabel = {
  /** Identifikátor štítku v Gmailu, třeba „Label_12“. */
  id: string;
  /** Celé jméno i s nadřazenými štítky, třeba „Ultra_Marine/MRL“. */
  name: string;
  /**
   * Klient, kterému pošta z tohohle štítku patří. Kdo si v Gmailu třídí poštu
   * do štítků podle značek, tím appce řekne, čí zpráva je — bez ohledu na to,
   * z jaké adresy přišla. Když chybí, klient se pozná podle adresy odesílatele.
   */
  clientId?: string;
};

/**
 * Doručená pošta je jedním ze zdrojů, ze kterých jde vybírat — v Gmailu má
 * pevný identifikátor. Kdo má všechnu pracovní poštu ve štítcích, může ji
 * odškrtnout a appka pak čte jen štítky (a netřídí soukromou poštu z doručené).
 */
export const INBOX_ID = "INBOX";
export const INBOX_LABEL: MailLabel = { id: INBOX_ID, name: "Doručená pošta" };

/** Víc štítků už je spíš omyl — a každý znamená další dotaz na Gmail při každém načtení. */
export const LABELS_MAX = 20;

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Výběr štítků tak, jak se uloží: jen štítky, které v Gmailu opravdu jsou
 * (`available`), se jménem z Gmailu, ne z prohlížeče. Neznámé identifikátory
 * se zahodí, opakované taky. Řadí se podle jména, ať je nadřazený štítek před
 * svými podštítky; doručená pošta (`INBOX_ID`) je první.
 *
 * Jen doručená pošta je výchozí stav a ukládá se jako prázdný výběr — stejně
 * jako u schránky, kde nikdo nic nevybíral.
 *
 * `clients` říká, kterému klientovi který štítek patří (`{ idŠtítku: idKlienta }`).
 * Uloží se jen klient, který ve studiu opravdu je (`validClientIds`); doručená
 * pošta klienta mít nemůže — do ní chodí všechno.
 */
export function pickLabels(
  ids: unknown,
  available: MailLabel[],
  clients: unknown = null,
  validClientIds: ReadonlySet<string> = new Set(),
): MailLabel[] {
  const komu = clients && typeof clients === "object" ? (clients as Record<string, unknown>) : {};
  if (!Array.isArray(ids)) return [];
  const chteno = new Set(ids.filter((id): id is string => typeof id === "string" && ID.test(id)));
  const out: MailLabel[] = chteno.has(INBOX_ID) ? [INBOX_LABEL] : [];
  const podleJmena = [...available].sort((a, b) => a.name.localeCompare(b.name, "cs", { sensitivity: "base" }));
  for (const l of podleJmena) {
    if (l.id === INBOX_ID || !chteno.has(l.id) || out.some((x) => x.id === l.id)) continue;
    if (out.length === LABELS_MAX) break;
    const clientId = komu[l.id];
    out.push(
      typeof clientId === "string" && validClientIds.has(clientId)
        ? { id: l.id, name: l.name, clientId }
        : { id: l.id, name: l.name },
    );
  }
  return out.length === 1 && out[0].id === INBOX_ID ? [] : out;
}

/**
 * Klient štítku: jeho vlastní, a když žádného nemá, klient nejbližšího
 * nadřazeného štítku. Podštítek „Ultra_Marine/Tiskarna UME“ bez klienta tak
 * patří tomu, komu patří „Ultra_Marine“ — nemusí se vyplňovat u každého zvlášť.
 */
export function clientOfLabel(labels: MailLabel[], label: MailLabel): string | null {
  if (label.clientId) return label.clientId;
  const predci = labels
    .filter((p) => p.clientId && label.name.startsWith(`${p.name}/`))
    .sort((a, b) => b.name.length - a.name.length);
  return predci[0]?.clientId ?? null;
}

/**
 * Komu patří zpráva nalezená pod štítky `labelIds`. Když je pod víc štítky,
 * rozhodne ten nejkonkrétnější — podštítek („Ultra_Marine/MRL“) má přednost
 * před nadřazeným („Ultra_Marine“). `null`, když klienta nemá žádný z nich
 * ani jejich nadřazené štítky.
 */
export function labelClient(labels: MailLabel[], labelIds: readonly string[]): string | null {
  const kandidati = labels
    .filter((l) => labelIds.includes(l.id))
    .map((l) => ({ name: l.name, clientId: clientOfLabel(labels, l) }))
    .filter((l) => l.clientId)
    .sort((a, b) => b.name.split("/").length - a.name.split("/").length || b.name.length - a.name.length);
  return kandidati[0]?.clientId ?? null;
}

/**
 * Odkud se má pošta načíst. Bez výběru jen z doručené. S výběrem ze štítků —
 * a z doručené jen tehdy, když je mezi vybranými i ona.
 */
export function mailSources(labels: MailLabel[]): { inbox: boolean; labelIds: string[] } {
  const labelIds = labels.filter((l) => l.id !== INBOX_ID).map((l) => l.id);
  return { inbox: labelIds.length === 0 || labels.some((l) => l.id === INBOX_ID), labelIds };
}

/** Uložený výběr přečtený z databáze — cokoli, co nemá správný tvar, se přeskočí. */
export function readLabels(value: unknown): MailLabel[] {
  if (!Array.isArray(value)) return [];
  const out: MailLabel[] = [];
  for (const v of value) {
    if (!v || typeof v !== "object") continue;
    const { id, name, clientId } = v as Record<string, unknown>;
    if (typeof id !== "string" || !ID.test(id) || typeof name !== "string" || !name.trim()) continue;
    if (out.some((x) => x.id === id)) continue;
    const stitek: MailLabel = { id, name: name.slice(0, 200) };
    if (id !== INBOX_ID && typeof clientId === "string" && UUID.test(clientId)) stitek.clientId = clientId;
    out.push(stitek);
    if (out.length === LABELS_MAX) break;
  }
  return out;
}

export type LabelRow = MailLabel & {
  /** Jméno bez nadřazených štítků. */
  short: string;
  /** Jak hluboko je zanořený (0 = nahoře). */
  depth: number;
};

/**
 * Štítky seřazené pro výběr: podle abecedy, podštítky hned pod svým
 * nadřazeným štítkem a odsazené.
 */
export function labelRows(labels: MailLabel[]): LabelRow[] {
  const jmena = new Set(labels.map((l) => l.name));
  return [...labels]
    .sort((a, b) => a.name.localeCompare(b.name, "cs", { sensitivity: "base" }))
    .map((l) => {
      // Lomítko je oddělovač jen tehdy, když nadřazený štítek opravdu existuje —
      // jinak je to obyčejný znak ve jméně („Faktury 2025/2026“).
      const casti = l.name.split("/");
      let depth = 0;
      let od = 0;
      for (let i = 1; i < casti.length; i++) {
        if (jmena.has(casti.slice(0, i).join("/"))) {
          depth++;
          od = i;
        }
      }
      return { ...l, short: casti.slice(od).join("/"), depth };
    });
}

/** Štítek a všechny jeho podštítky — identifikátory. */
export function withChildren(labels: MailLabel[], id: string): string[] {
  const rodic = labels.find((l) => l.id === id);
  if (!rodic) return [];
  return labels.filter((l) => l.id === id || l.name.startsWith(`${rodic.name}/`)).map((l) => l.id);
}

/** Odkud se pošta načítá, jednou větou do nastavení. */
export function sourcesLabel(labels: MailLabel[]): string {
  const stitky = labels.filter((l) => l.id !== INBOX_ID);
  if (stitky.length === 0) return "z doručené pošty";
  const jmena = stitky.map((l) => `„${l.name}“`).join(", ");
  const zeStitku = stitky.length === 1 ? `ze štítku ${jmena}` : `ze štítků ${jmena}`;
  return mailSources(labels).inbox ? `z doručené pošty a ${zeStitku}` : `jen ${zeStitku}`;
}

/**
 * Vlákna z několika zdrojů (doručená pošta a jednotlivé štítky) do jednoho
 * seznamu bez opakování. Bere se střídavě z každého zdroje, aby při stropu
 * `max` žádný štítek nevytlačil ostatní; uvnitř zdroje zůstává pořadí od
 * nejnovějšího.
 */
export function mergeThreadIds(sources: string[][], max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const nejdelsi = Math.max(0, ...sources.map((s) => s.length));
  for (let i = 0; i < nejdelsi && out.length < max; i++) {
    for (const source of sources) {
      const id = source[i];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= max) break;
    }
  }
  return out;
}
