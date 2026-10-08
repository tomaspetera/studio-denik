/**
 * Štítky Gmailu, ze kterých se pošta načítá navíc k doručené — výběr, řazení
 * a slučování vláken. Bez sítě, bez databáze a bez AI.
 *
 * Výběr přichází z prohlížeče, takže test hlídá hlavně to, že se uloží jen
 * štítky, které v Gmailu opravdu jsou, a se jménem z Gmailu. A že podštítky
 * (v Gmailu samostatné štítky) se chovají tak, jak člověk čeká.
 */
import {
  INBOX_ID,
  INBOX_LABEL,
  LABELS_MAX,
  labelClient,
  labelRows,
  mailSources,
  mergeThreadIds,
  pickLabels,
  readLabels,
  sourcesLabel,
  withChildren,
} from "../lib/mail-labels.ts";

let chyby = 0;
const ok = (s) => console.log("  " + s);
const zkouska = (nazev, cond, popis) => {
  if (cond) ok(`${nazev.padEnd(26)}ok — ${popis}`);
  else { chyby++; ok(`${nazev.padEnd(26)}ŠPATNĚ — ${popis}`); }
};
const stejne = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Štítky tak, jak je vrací Gmail — bez pořadí, podštítky celým jménem.
const GMAIL = [
  { id: "Label_7", name: "Zdravě žít" },
  { id: "Label_2", name: "Ultra_Marine/MRL" },
  { id: "Label_1", name: "Ultra_Marine" },
  { id: "Label_3", name: "Ultra_Marine/Tiskarna UME" },
  { id: "Label_5", name: "WEDOS domény" },
  { id: "Label_9", name: "Faktury 2025/2026" },
  { id: "Label_4", name: "Kreativní kancl" },
];

// --- Co se uloží ---------------------------------------------------------------------
let v = pickLabels(["Label_1", "Label_2"], GMAIL);
zkouska("výběr", stejne(v, [{ id: "Label_1", name: "Ultra_Marine" }, { id: "Label_2", name: "Ultra_Marine/MRL" }]), "vybrané štítky se jménem z Gmailu, nadřazený před podštítkem");
v = pickLabels(["Label_1", "Label_999", "SENT", "Label_1"], GMAIL);
zkouska("neznámý štítek", stejne(v.map((l) => l.id), ["Label_1"]), "co v Gmailu není (i systémový štítek), se neuloží; opakování taky ne");
v = pickLabels([{ id: "Label_1", name: "Podvrh" }, 42, null, "Label 1", "a".repeat(200)], GMAIL);
zkouska("nesmysly z prohlížeče", v.length === 0, "cokoli jiného než identifikátor se zahodí");
zkouska("nic k výběru", pickLabels("Label_1", GMAIL).length === 0 && pickLabels(undefined, GMAIL).length === 0 && pickLabels(["Label_1"], []).length === 0, "když nepřijde seznam nebo Gmail žádné štítky nemá");
const mnoho = Array.from({ length: LABELS_MAX + 5 }, (_, i) => ({ id: `L${i}`, name: `Štítek ${i}` }));
zkouska("strop", pickLabels(mnoho.map((l) => l.id), mnoho).length === LABELS_MAX, `nejvýš ${LABELS_MAX} štítků`);

// --- Čtení z databáze ------------------------------------------------------------------
zkouska("uložený výběr", stejne(readLabels([{ id: "Label_1", name: "Ultra_Marine" }, { id: "Label_2", name: "Ultra_Marine/MRL", navic: 1 }]), [{ id: "Label_1", name: "Ultra_Marine" }, { id: "Label_2", name: "Ultra_Marine/MRL" }]), "tvar z databáze, nic navíc");
zkouska("poškozený výběr", stejne(readLabels([null, "Label_1", { id: 5, name: "x" }, { id: "Label_1" }, { id: "Label_1", name: "  " }, { id: "ok", name: "V pořádku" }, { id: "ok", name: "Dvakrát" }]), [{ id: "ok", name: "V pořádku" }]) && readLabels(null).length === 0 && readLabels({}).length === 0, "co nemá správný tvar, se přeskočí — načtení pošty kvůli tomu nespadne");

// --- Řazení pro výběr ---------------------------------------------------------------------
const radky = labelRows(GMAIL);
zkouska("pořadí", stejne(radky.map((r) => r.name), ["Faktury 2025/2026", "Kreativní kancl", "Ultra_Marine", "Ultra_Marine/MRL", "Ultra_Marine/Tiskarna UME", "WEDOS domény", "Zdravě žít"]), "podle abecedy, podštítky hned pod nadřazeným");
zkouska("odsazení", stejne(radky.map((r) => r.depth), [0, 0, 0, 1, 1, 0, 0]), "podštítky o úroveň níž");
zkouska("krátké jméno", radky[3].short === "MRL" && radky[4].short === "Tiskarna UME" && radky[2].short === "Ultra_Marine", "podštítek bez jména nadřazeného");
zkouska("lomítko ve jméně", radky[0].short === "Faktury 2025/2026" && radky[0].depth === 0, "lomítko není podštítek, když nadřazený štítek neexistuje");
const hluboko = labelRows([{ id: "a", name: "A" }, { id: "c", name: "A/B/C" }, { id: "b", name: "A/B" }]);
zkouska("tři úrovně", stejne(hluboko.map((r) => [r.short, r.depth]), [["A", 0], ["B", 1], ["C", 2]]), "zanoření do hloubky");

// --- Podštítky ---------------------------------------------------------------------------------
zkouska("s podštítky", stejne(withChildren(GMAIL, "Label_1").sort(), ["Label_1", "Label_2", "Label_3"]), "nadřazený štítek vezme i své podštítky");
zkouska("jen podštítek", stejne(withChildren(GMAIL, "Label_2"), ["Label_2"]), "podštítek nadřazený nezaškrtne");
zkouska("podobné jméno", stejne(withChildren([{ id: "a", name: "Ultra" }, { id: "b", name: "Ultra_Marine" }, { id: "c", name: "Ultra/X" }], "a").sort(), ["a", "c"]), "štítek, který jen stejně začíná, podštítek není");
zkouska("neznámý", withChildren(GMAIL, "nic").length === 0, "neznámý identifikátor nevybere nic");

// --- Odkud se načítá ---------------------------------------------------------------------------------
zkouska("věta: jen doručená", sourcesLabel([]) === "z doručené pošty" && sourcesLabel([INBOX_LABEL]) === "z doručené pošty", "bez výběru jako dosud");
zkouska("věta: jen štítek", sourcesLabel([{ id: "Label_1", name: "Ultra_Marine" }]) === "jen ze štítku „Ultra_Marine“", "štítek bez doručené pošty");
zkouska("věta: jen štítky", sourcesLabel([{ id: "Label_1", name: "Ultra_Marine" }, { id: "Label_2", name: "Ultra_Marine/MRL" }]) === "jen ze štítků „Ultra_Marine“, „Ultra_Marine/MRL“", "víc štítků bez doručené pošty");
zkouska("věta: obojí", sourcesLabel([INBOX_LABEL, { id: "Label_1", name: "Ultra_Marine" }]) === "z doručené pošty a ze štítku „Ultra_Marine“" && sourcesLabel([INBOX_LABEL, { id: "Label_1", name: "Ultra_Marine" }, { id: "Label_2", name: "Ultra_Marine/MRL" }]) === "z doručené pošty a ze štítků „Ultra_Marine“, „Ultra_Marine/MRL“", "doručená pošta i štítky");

// --- Doručená pošta jako jeden ze zdrojů -----------------------------------------------------------
zkouska("zdroje: bez výběru", stejne(mailSources([]), { inbox: true, labelIds: [] }), "kdo nic nevybral, čte doručenou poštu");
zkouska("zdroje: jen štítky", stejne(mailSources([{ id: "Label_1", name: "Ultra_Marine" }, { id: "Label_2", name: "Ultra_Marine/MRL" }]), { inbox: false, labelIds: ["Label_1", "Label_2"] }), "výběr bez doručené pošty ji vynechá — nečte se a netřídí");
zkouska("zdroje: obojí", stejne(mailSources([INBOX_LABEL, { id: "Label_1", name: "Ultra_Marine" }]), { inbox: true, labelIds: ["Label_1"] }), "doručená pošta se čte, jen když je mezi vybranými");
zkouska("zdroje: jen doručená", stejne(mailSources([INBOX_LABEL]), { inbox: true, labelIds: [] }), "doručená pošta sama");
v = pickLabels([INBOX_ID, "Label_2", "Label_1"], GMAIL);
zkouska("výběr s doručenou", stejne(v, [INBOX_LABEL, { id: "Label_1", name: "Ultra_Marine" }, { id: "Label_2", name: "Ultra_Marine/MRL" }]), "doručená pošta první, pak štítky podle jména");
zkouska("výběr: jen doručená", pickLabels([INBOX_ID], GMAIL).length === 0 && pickLabels([INBOX_ID, "Label_999"], GMAIL).length === 0, "jen doručená pošta je výchozí stav — uloží se prázdný výběr");
zkouska("výběr: podvržená doručená", stejne(pickLabels(["Label_1"], [...GMAIL, { id: INBOX_ID, name: "Podvrh" }]), [{ id: "Label_1", name: "Ultra_Marine" }]) && stejne(pickLabels([INBOX_ID, "Label_1"], [...GMAIL, { id: INBOX_ID, name: "Podvrh" }])[0], INBOX_LABEL), "jméno doručené pošty určuje appka, ne seznam z Gmailu");
zkouska("výběr: strop s doručenou", pickLabels([INBOX_ID, ...mnoho.map((l) => l.id)], mnoho).length === LABELS_MAX, "strop platí i s doručenou poštou — databáze víc nepřijme");
zkouska("uložená doručená", stejne(readLabels([{ id: "INBOX", name: "Doručená pošta" }, { id: "Label_1", name: "Ultra_Marine" }]), [INBOX_LABEL, { id: "Label_1", name: "Ultra_Marine" }]), "výběr s doručenou poštou se z databáze přečte celý");

// --- Klient u štítku ------------------------------------------------------------------------------------
const MRL_K = "11111111-1111-4111-8111-111111111111";
const UME_K = "22222222-2222-4222-8222-222222222222";
const PLATNI = new Set([MRL_K, UME_K]);
v = pickLabels(["Label_1", "Label_2", "Label_3"], GMAIL, { Label_1: UME_K, Label_2: MRL_K, Label_3: "" }, PLATNI);
zkouska("klient: uložení", stejne(v, [{ id: "Label_1", name: "Ultra_Marine", clientId: UME_K }, { id: "Label_2", name: "Ultra_Marine/MRL", clientId: MRL_K }, { id: "Label_3", name: "Ultra_Marine/Tiskarna UME" }]), "štítek si nese klienta; bez výběru zůstane bez něj");
v = pickLabels(["Label_1", "Label_2"], GMAIL, { Label_1: "33333333-3333-4333-8333-333333333333", Label_2: 42, Label_9: MRL_K }, PLATNI);
zkouska("klient: cizí nebo smazaný", v.every((l) => !("clientId" in l)), "klient, který ve studiu není, se neuloží — ani nesmysl, ani klient u nevybraného štítku");
v = pickLabels([INBOX_ID, "Label_1"], GMAIL, { INBOX: UME_K, Label_1: UME_K }, PLATNI);
zkouska("klient: doručená pošta", !("clientId" in v[0]) && v[1].clientId === UME_K, "doručená pošta klienta mít nemůže — chodí do ní všechno");
zkouska("klient: bez mapy", pickLabels(["Label_1"], GMAIL, null, PLATNI).every((l) => !("clientId" in l)) && pickLabels(["Label_1"], GMAIL, "nesmysl", PLATNI).length === 1, "bez přiřazení se nic nemění");
zkouska("klient: z databáze", stejne(readLabels([{ id: "Label_2", name: "Ultra_Marine/MRL", clientId: MRL_K }, { id: "Label_1", name: "Ultra_Marine", clientId: "neni-uuid" }, { id: "INBOX", name: "Doručená pošta", clientId: MRL_K }]), [{ id: "Label_2", name: "Ultra_Marine/MRL", clientId: MRL_K }, { id: "Label_1", name: "Ultra_Marine" }, { id: "INBOX", name: "Doručená pošta" }]), "klient se přečte jen ve správném tvaru a nikdy u doručené pošty");
const ULOZENE = [{ id: "Label_1", name: "Ultra_Marine", clientId: UME_K }, { id: "Label_2", name: "Ultra_Marine/MRL", clientId: MRL_K }, { id: "Label_3", name: "Ultra_Marine/Tiskarna UME" }];
zkouska("komu: jeden štítek", labelClient(ULOZENE, ["Label_2"]) === MRL_K && labelClient(ULOZENE, ["Label_1"]) === UME_K, "klient štítku, pod kterým zpráva leží");
zkouska("komu: podštítek vyhrává", labelClient(ULOZENE, ["Label_1", "Label_2"]) === MRL_K && labelClient(ULOZENE, ["Label_2", "Label_1"]) === MRL_K, "zpráva pod nadřazeným štítkem i podštítkem patří klientovi podštítku, ať jdou v jakémkoli pořadí");
zkouska("komu: dědí nadřazený", labelClient(ULOZENE, ["Label_3"]) === UME_K, "podštítek bez klienta patří tomu, komu nadřazený štítek");
zkouska("komu: nejbližší předek", labelClient([{ id: "a", name: "A", clientId: UME_K }, { id: "b", name: "A/B", clientId: MRL_K }, { id: "c", name: "A/B/C" }], ["c"]) === MRL_K, "dědí se od nejbližšího nadřazeného, ne od nejvyššího");
zkouska("komu: bez předka", labelClient([{ id: "x", name: "Ultra", clientId: UME_K }, { id: "y", name: "Ultra_Marine" }], ["y"]) === null && labelClient([{ id: "y", name: "WEDOS" }], ["y"]) === null, "štítek, který jen stejně začíná, nadřazený není — klienta určí adresa");
zkouska("komu: nic", labelClient(ULOZENE, []) === null && labelClient([], ["Label_1"]) === null && labelClient(ULOZENE, ["Label_999"]) === null, "bez štítků nebo bez přiřazení žádný klient");

// --- Slučování vláken ---------------------------------------------------------------------------------
zkouska("sloučení", stejne(mergeThreadIds([["a", "b", "c"], ["x", "b"], ["y"]], 90), ["a", "x", "y", "b", "c"]), "střídavě z každého zdroje, stejné vlákno jen jednou");
zkouska("strop na počet", stejne(mergeThreadIds([["a1", "a2", "a3", "a4"], ["b1", "b2", "b3"], ["c1"]], 5), ["a1", "b1", "c1", "a2", "b2"]), "při stropu se dostane na každý zdroj, plná doručená štítky nevytlačí");
zkouska("jen doručená", stejne(mergeThreadIds([["a", "b"]], 90), ["a", "b"]) && mergeThreadIds([], 90).length === 0 && mergeThreadIds([[], []], 90).length === 0, "bez štítků se nic nemění; prázdné zdroje nevadí");

// Žádná otevřená spojení, proces doběhne sám.
console.log(chyby === 0 ? "\nŠtítky: výběr, řazení i slučování drží." : `\nProblémů: ${chyby}`);
process.exitCode = chyby === 0 ? 0 : 1;
