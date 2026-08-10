/**
 * Dohledání firmy v ARESu.
 *
 * Kontrolní číslice se počítá u nás, dotaz na rejstřík až potom — překlep
 * v IČO je běžnější než neexistující firma a nemá smysl na něj čekat.
 *
 * Test se ptá skutečného ARESu. Když zrovna neodpovídá, pozná se to podle
 * hlášky a není to chyba v aplikaci — proto se rozlišuje.
 */

const ENDPOINT = "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty";

function normalizeIco(input) {
  const d = String(input).replace(/\D/g, "");
  return d.length > 0 && d.length < 8 ? d.padStart(8, "0") : d;
}

function isValidIco(input) {
  const ico = normalizeIco(input);
  if (!/^\d{8}$/.test(ico)) return false;
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(ico[i]) * (8 - i);
  const rest = sum % 11;
  const check = rest === 0 ? 1 : rest === 1 ? 0 : 11 - rest;
  return check === Number(ico[7]);
}

const ok = (s) => console.log("  " + s);
let chyby = 0;
let aresMlci = false;

/* --- kontrolní číslice ------------------------------------------------ */

const PLATNA = ["27604977", "00006947", "26185610", "45274649", "6947"];
const NEPLATNA = ["12345678", "27604978", "00000000", "1234567", "abc", ""];

const spatne = [
  ...PLATNA.filter((i) => !isValidIco(i)).map((i) => `${i} mělo projít`),
  ...NEPLATNA.filter((i) => isValidIco(i)).map((i) => `${i} nemělo projít`),
];

if (spatne.length) {
  chyby += spatne.length;
  spatne.forEach((s) => ok(`kontrolní číslice ŠPATNĚ — ${s}`));
} else {
  ok(`kontrolní číslice ok — ${PLATNA.length} platných prošlo, ${NEPLATNA.length} neplatných neprošlo`);
}

ok(`doplnění nul     ok — "6947" → "${normalizeIco("6947")}"`);

/* --- skutečné dotazy -------------------------------------------------- */

async function ares(ico) {
  const res = await fetch(`${ENDPOINT}/${normalizeIco(ico)}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  return { status: res.status, data: res.ok ? await res.json() : null };
}

try {
  const { status, data } = await ares("27604977");
  if (status !== 200 || !data?.obchodniJmeno) {
    chyby++;
    ok(`dohledání        ŠPATNĚ — HTTP ${status}`);
  } else {
    ok(`dohledání        ok — "${data.obchodniJmeno}"`);
    if (!data.dic) { chyby++; ok("  DIČ chybí"); }
    else ok(`                 DIČ ${data.dic}`);
    if (!data.sidlo?.textovaAdresa) { chyby++; ok("  adresa chybí"); }
    else ok(`                 ${data.sidlo.textovaAdresa}`);
  }
} catch (e) {
  aresMlci = true;
  ok(`dohledání        ARES neodpověděl — ${String(e?.message ?? e).slice(0, 80)}`);
}

if (!aresMlci) {
  try {
    // Platná kontrolní číslice, ale firma neexistuje — musí přijít 404,
    // ne pád. Právě na tuhle větev se v rozhraní spoléhá hláška
    // "V rejstříku nikdo s tímhle IČO není".
    const { status } = await ares("11111119");
    if (status !== 404) { chyby++; ok(`neexistující     ŠPATNĚ — HTTP ${status}, čekáno 404`); }
    else ok("neexistující     ok — rejstřík vrací 404");
  } catch (e) {
    ok(`neexistující     ARES neodpověděl — ${String(e?.message ?? e).slice(0, 60)}`);
  }
}

console.log(
  chyby === 0
    ? aresMlci
      ? "\nKontrolní číslice sedí. ARES teď neodpovídá — na aplikaci to nevypovídá."
      : "\nDohledání v ARESu funguje."
    : `\nProblémů: ${chyby}`,
);
process.exit(chyby === 0 ? 0 : 1);
