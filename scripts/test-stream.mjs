/**
 * Ověří, že text opravdu přichází průběžně — na tom stojí obejití
 * časového limitu hostingu. Kdyby dorazil až celý najednou, stream by
 * byl k ničemu a report by na Vercelu spadl.
 */
import { GoogleGenAI } from "@google/genai";

const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const t0 = Date.now();
let prvni = null;
let casti = 0;
let znaku = 0;

// Stejné opakování, jaké má aplikace v lib/ai.ts — přetížení modelu
// je běžný přechodný stav a musí se obalit až otevření streamu.
async function openStream() {
  for (let i = 0; ; i++) {
    try {
      return await ai.models.generateContentStream({
        model,
        contents:
          "Napiš tři odstavce česky o tom, jak proběhl týden v grafickém studiu. " +
          "Vymysli si běžné zakázky — letáky, katalog, vizitky.",
        config: { systemInstruction: "Píšeš věcně, bez oslovení a bez pozdravu." },
      });
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (!/UNAVAILABLE|high demand|503/.test(msg) || i >= 3) throw e;
      console.log(`  (model přetížený, zkouším znovu za ${1 + i * 2} s)`);
      await new Promise((r) => setTimeout(r, 1000 * (1 + i * 2)));
    }
  }
}

const stream = await openStream();

for await (const chunk of stream) {
  const t = chunk.text;
  if (!t) continue;
  casti++;
  znaku += t.length;
  if (prvni === null) {
    prvni = Date.now() - t0;
    console.log(`  první část dorazila za ${prvni} ms`);
  }
}

const celkem = Date.now() - t0;
console.log(`  částí: ${casti}, znaků: ${znaku}, celkem ${celkem} ms`);

const problemy = [];
if (casti < 3) problemy.push(`jen ${casti} částí — text nejspíš přišel najednou`);
if (prvni !== null && prvni > 9000) {
  problemy.push(`první část až za ${prvni} ms — limit hostingu je 10 000 ms`);
}

console.log(
  problemy.length === 0
    ? `\nOK — text teče průběžně, první data do ${prvni} ms. Limit 10 s se stihne.`
    : "\nVýhrady:\n" + problemy.map((p) => "  - " + p).join("\n"),
);
process.exit(problemy.length === 0 ? 0 : 1);
