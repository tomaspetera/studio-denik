/** Zkusí, které Gemini modely tvůj klíč opravdu obslouží. */
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const kandidati = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.1-pro-preview",
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
  "gemini-pro-latest",
  "gemini-flash-latest",
  "gemini-3.5-flash-lite",
];

for (const model of kandidati) {
  const t0 = Date.now();
  try {
    const r = await ai.models.generateContent({
      model,
      contents: "Napiš jednu krátkou českou větu o tom, že tiskárna nedodala roll-up včas.",
    });
    const ms = Date.now() - t0;
    console.log(`  ${model.padEnd(24)} OK  ${String(ms).padStart(5)} ms  ${JSON.stringify((r.text ?? "").trim().slice(0, 70))}`);
  } catch (e) {
    const msg = String(e?.message ?? e);
    const code = /"code":\s*(\d+)/.exec(msg)?.[1] ?? "?";
    const short = /RESOURCE_EXHAUSTED|quota/i.test(msg)
      ? "vyčerpaná kvóta"
      : /no longer available|not found/i.test(msg)
      ? "neexistuje"
      : msg.slice(0, 70);
    console.log(`  ${model.padEnd(24)} chyba ${code} — ${short}`);
  }
}
