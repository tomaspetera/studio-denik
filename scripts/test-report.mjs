/** Zkouška textu reportu na realistických datech — jestli AI píše použitelně. */
import { GoogleGenAI } from "@google/genai";

const SYSTEM = `Píšeš týdenní report grafického studia pro nadřízeného nebo klienta.

Píšeš česky, věcně a bez vaty. Žádné oslovení, žádný závěrečný pozdrav — text
se vkládá do hotového dokumentu, který hlavičku i patičku už má.

Dva až tři odstavce. První shrne, čím byl týden tažený a kde leželo těžiště
práce. Druhý pokryje zbytek, typicky administrativu a komunikaci. Pokud něco
uvázlo na cizí straně, patří to do posledního odstavce a musí být zřejmé, že
to není zdržení na naší straně.

Vycházej jen z dodaných dat. Nic si nedomýšlej, nepřidávej čísla, která
v podkladech nejsou, a nepiš marketingové fráze o skvělé spolupráci.`;

const PROMPT = `Období: 3.–9. srpna 2026
Čísla: 12 uzavřeno, 5 rozpracováno, 3 čeká na klienta, 3 u dodavatele, 2 po termínu.

Rozdělení práce: Grafika 38 %, Tisk 24 %, Administrativa 17 %, Komunikace 13 %, Web a sítě 8 %

Uzavřeno v období:
  - Letáky A5 na letní nabídku [Pekárna U Lípy]
  - Cenovky do prodejny, sada 24 kusů [Pekárna U Lípy]
  - Příspěvky na Instagram na srpen [Pekárna U Lípy]
  - Katalog podzimních akcí, sazba 32 stran [Městská knihovna Beroun]
  - Plakát A2 na Noc literatury [Městská knihovna Beroun]
  - Aktualizace vizuálního manuálu [Městská knihovna Beroun]
  - Bannery na web, 4 rozměry [Fitness Zenit]
  - Rozvrh lekcí, nová šablona [Fitness Zenit]
  - Samolepky 2 000 ks, dodáno a předáno [AutoCentrum Švec]
  - Inzerát do regionálního tisku [AutoCentrum Švec]
  - Vyúčtování za červenec
  - Aktualizace ceníku pro rok 2027

Čeká se na cizí straně:
  - Roll-up 2 ks [Fitness Zenit] — U dodavatele, tiskárna Grafiko, PO TERMÍNU
  - Vizitky [Nováková a partneři] — U klienta, PO TERMÍNU
  - Letáky 5 000 ks [Pekárna U Lípy] — U dodavatele, tiskárna Grafiko
  - Katalog 800 ks [Městská knihovna Beroun] — U dodavatele, Tiskárna Nová
  - Korektury letáků [Pekárna U Lípy] — U klienta

Rozpracováno u nás:
  - Polepy vozů, příprava podkladů [AutoCentrum Švec] (Dělám)
  - Nabídka na novou identitu [Kavárna Ateliér] (Dělám)`;

const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const t0 = Date.now();
let res;
for (let i = 0; i < 4; i++) {
  try {
    res = await ai.models.generateContent({
      model,
      contents: PROMPT,
      config: { systemInstruction: SYSTEM },
    });
    break;
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (!/UNAVAILABLE|high demand|503/.test(msg) || i === 3) throw e;
    console.log(`  (model přetížený, zkouším znovu za ${1 + i * 2} s)`);
    await new Promise((r) => setTimeout(r, 1000 * (1 + i * 2)));
  }
}
const text = (res.text ?? "").trim();

console.log(`model: ${model}   ${Date.now() - t0} ms\n`);
console.log("─".repeat(74));
console.log(text);
console.log("─".repeat(74));

const odstavce = text.split(/\n{2,}/).filter(Boolean);
const problemy = [];
if (odstavce.length < 2 || odstavce.length > 4) problemy.push(`odstavců: ${odstavce.length} (čekáno 2–3)`);
if (/^(dobrý den|vážený|ahoj)/i.test(text)) problemy.push("začíná oslovením");
if (/s pozdravem|děkuji za|těším se/i.test(text)) problemy.push("obsahuje pozdrav");
if (/skvěl|výborn[áé] spoluprác|úspěšně jsme/i.test(text)) problemy.push("marketingová fráze");
if (!/Grafiko|tiskárn/i.test(text)) problemy.push("nezmiňuje zdržení u dodavatele");

console.log(
  problemy.length === 0
    ? `\nOK — ${odstavce.length} odstavce, ${text.length} znaků, bez oslovení i frází.`
    : "\nVýhrady:\n" + problemy.map((p) => "  - " + p).join("\n"),
);
