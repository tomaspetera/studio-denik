/**
 * Rychlý zápis — živá zkouška s opravdovou AI.
 *
 * NENÍ součástí `npm test`: volá skutečný model (kvóta, síť) a odpověď
 * jazykového modelu se může mezi běhy trochu lišit. Pouští se ručně, když se
 * mění prompt, schéma nebo model: `npm run test:ai`.
 *
 * Běží nad skutečným `lib/ai.ts` a `lib/capture.ts`, tedy přesně tím kódem,
 * který poběží v appce. Proto potřebuje háček `stub-register.mjs` (`server-only`
 * mimo Next neexistuje) a `--experimental-transform-types` (`ai.ts` má
 * vlastnosti v konstruktoru, které prosté odstranění typů nezvládne).
 */
import { extractJson, pickProvider } from "../lib/ai.ts";
import { CAPTURE_JSON_SCHEMA, buildCapturePrompt, normalizeProposals } from "../lib/capture.ts";
import { isoWeekday } from "../lib/presets.ts";

let chyby = 0;
const ok = (s) => console.log("  " + s);
const zkouska = (nazev, cond, popis) => {
  if (cond) ok(`${nazev.padEnd(28)}ok — ${popis}`);
  else { chyby++; ok(`${nazev.padEnd(28)}ŠPATNĚ — ${popis}`); }
};

const provider = pickProvider();
if (!provider) {
  console.log("Přeskočeno: není nastavený žádný AI klíč (GEMINI_API_KEY ani ANTHROPIC_API_KEY).");
  process.exit(0);
}

const dnes = (() => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}`;
})();

const ctx = {
  today: dnes,
  clients: [
    { id: "lipa", name: "Pekárna U Lípy" },
    { id: "ume", name: "ULTRA MARINE EUROPE s.r.o." },
    { id: "letter", name: "MR.LETTER" },
  ],
  categories: [
    { id: "grafika", name: "Grafika" },
    { id: "tisk", name: "Tisk" },
    { id: "admin", name: "Administrativa" },
    { id: "web", name: "Web a sítě" },
  ],
};

const text = `Letáky A5 pro Pekárnu U Lípy jsem v úterý poslal do tiskárny. Dnes jsem dokončil grafický manuál pro Ultra Marine. V pátek musím poslat nabídku Novákovi na nový web. Objednat papír do tiskárny.`;

console.log(`Model: ${provider}, dnes ${dnes}`);
const { system, prompt } = buildCapturePrompt(text, ctx);
const t0 = Date.now();
const raw = await extractJson(provider, system, prompt, CAPTURE_JSON_SCHEMA);
const ms = Date.now() - t0;
const { proposals, warnings } = normalizeProposals(raw, ctx);

console.log(`\nOdpověď za ${ms} ms, ${proposals.length} návrhů:`);
for (const p of proposals) {
  console.log(`   • ${p.title} | ${p.kind} krok ${p.step} | klient ${p.clientId ?? "—"} | kat. ${p.categoryId ?? "—"} | termín ${p.dueKey ?? "—"} | hotovo ${p.doneOn ?? "—"}`);
}
for (const w of warnings) console.log(`   ! ${w}`);
console.log("");

zkouska("počet úkolů", proposals.length >= 3 && proposals.length <= 6, "ze čtyř vět vzniknou zhruba čtyři úkoly");

const letaky = proposals.find((p) => /let[áa]k/i.test(p.title));
zkouska("letáky: klient a krok", letaky?.clientId === "lipa" && letaky?.kind === "tisk" && letaky?.step === 3, "tiskový úkol pro Lípu ve stavu „V tisku“");

const manual = proposals.find((p) => /manu[áa]l/i.test(p.title));
zkouska("manuál: hotový", manual?.clientId === "ume" && manual?.doneOn === dnes && manual.step === (manual.kind === "tisk" ? 5 : manual.kind === "klient" ? 3 : 2), "klient spárovaný z „Ultra Marine“, hotovo dnes");

zkouska("manuál: název hotové práce", !!manual && !/^(dokonč|dokonči|udělat|vytvořit|připravit)/i.test(manual.title), "hotový úkol se jmenuje jako práce, ne jako příkaz");

const nabidka = proposals.find((p) => /nab[ií]dk|web/i.test(p.title));
zkouska("nabídka: pátek", !!nabidka?.dueKey && isoWeekday(nabidka.dueKey) === 5 && nabidka.dueKey >= dnes, "„v pátek“ je nejbližší nadcházející pátek");
zkouska("Novák: neznámý klient", nabidka?.clientId === null && /nov[áa]k/i.test(nabidka?.title ?? ""), "klienta mimo seznam AI nevymyslela, ale jméno zůstalo v názvu");

const papir = proposals.find((p) => /pap[ií]r/i.test(p.title));
zkouska("papír: nový úkol", !!papir && papir.step === 0 && papir.doneOn === null, "„objednat“ je teprve potřeba");

// Žádná otevřená spojení, proces doběhne sám.
console.log(chyby === 0 ? "\nŽivá zkouška prošla." : `\nProblémů: ${chyby} (odpověď modelu se může lišit — zkus znovu, než začneš hledat chybu)`);
process.exitCode = chyby === 0 ? 0 : 1;
