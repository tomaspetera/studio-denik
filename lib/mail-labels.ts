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
};

/** Víc štítků už je spíš omyl — a každý znamená další dotaz na Gmail při každém načtení. */
export const LABELS_MAX = 20;

const ID = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Výběr štítků tak, jak se uloží: jen štítky, které v Gmailu opravdu jsou
 * (`available`), se jménem z Gmailu, ne z prohlížeče. Neznámé identifikátory
 * se zahodí, opakované taky. Řadí se podle jména, ať je nadřazený štítek před
 * svými podštítky.
 */
export function pickLabels(ids: unknown, available: MailLabel[]): MailLabel[] {
  if (!Array.isArray(ids)) return [];
  const chteno = new Set(ids.filter((id): id is string => typeof id === "string" && ID.test(id)));
  const out: MailLabel[] = [];
  const podleJmena = [...available].sort((a, b) => a.name.localeCompare(b.name, "cs", { sensitivity: "base" }));
  for (const l of podleJmena) {
    if (!chteno.has(l.id) || out.some((x) => x.id === l.id)) continue;
    out.push({ id: l.id, name: l.name });
    if (out.length === LABELS_MAX) break;
  }
  return out;
}

/** Uložený výběr přečtený z databáze — cokoli, co nemá správný tvar, se přeskočí. */
export function readLabels(value: unknown): MailLabel[] {
  if (!Array.isArray(value)) return [];
  const out: MailLabel[] = [];
  for (const v of value) {
    if (!v || typeof v !== "object") continue;
    const { id, name } = v as Record<string, unknown>;
    if (typeof id !== "string" || !ID.test(id) || typeof name !== "string" || !name.trim()) continue;
    if (out.some((x) => x.id === id)) continue;
    out.push({ id, name: name.slice(0, 200) });
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
  if (labels.length === 0) return "z doručené pošty";
  const jmena = labels.map((l) => `„${l.name}“`).join(", ");
  return labels.length === 1 ? `z doručené pošty a ze štítku ${jmena}` : `z doručené pošty a ze štítků ${jmena}`;
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
