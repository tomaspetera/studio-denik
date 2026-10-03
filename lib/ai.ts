import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { isNoCredit, isOverloaded, isQuotaError, isTimeout } from "./ai-errors.ts";

/**
 * Napojení na AI. Běží výhradně na serveru — `server-only` zajistí, že se
 * tenhle modul nedá omylem naimportovat do klientské komponenty a klíče
 * neskončí v prohlížeči.
 */

export type Provider = "claude" | "gemini";

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

// Na psaní reportu `flash` bohatě stačí a je několikrát levnější než `pro`.
// (Na bezplatné úrovni `pro` modely nejdou vůbec — vracejí 429 hned při
// prvním požadavku.)
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

export class AiNotConfigured extends Error {
  constructor(provider: Provider) {
    super(
      provider === "claude"
        ? "Chybí ANTHROPIC_API_KEY. Doplň ho do .env.local a restartuj server."
        : "Chybí GEMINI_API_KEY. Doplň ho do .env.local a restartuj server.",
    );
    this.name = "AiNotConfigured";
  }
}

export class AiRefused extends Error {
  constructor(public readonly category: string | null) {
    super("Model odmítl požadavek zpracovat.");
    this.name = "AiRefused";
  }
}

export class AiQuotaExceeded extends Error {
  constructor(provider: Provider, model: string) {
    super(
      `${provider === "claude" ? "Claude" : "Gemini"} odmítl požadavek kvůli vyčerpané kvótě (model ${model}). ` +
        `Zkus to později, nebo přepni model proměnnou ${provider === "claude" ? "ANTHROPIC_MODEL" : "GEMINI_MODEL"}.`,
    );
    this.name = "AiQuotaExceeded";
  }
}

/**
 * U Gemini se platí předem. Když kredit dojde, selže každé volání (HTTP 402),
 * dokud se nedobije — opakování ani jiný model nepomůže, takže se to člověku
 * řekne rovnou a srozumitelně.
 */
export class AiNoCredit extends Error {
  constructor() {
    super(
      "U Gemini došel předplacený kredit. Dobij ho v Google AI Studiu (Billing → Buy credits) a zkus to znovu.",
    );
    this.name = "AiNoCredit";
  }
}

/**
 * Které modely má aplikace reálně k dispozici.
 *
 * Nestačí, že proměnná existuje — zástupný text jako `sk-ant-` je pravdivá
 * hodnota, ale klíč to není. Bez téhle kontroly by appka nabídla Claude
 * a spadla by až ve chvíli, kdy na něj uživatel klikne.
 */
export function availableProviders(): Provider[] {
  const out: Provider[] = [];
  if (looksLikeKey(process.env.ANTHROPIC_API_KEY)) out.push("claude");
  if (looksLikeKey(process.env.GEMINI_API_KEY)) out.push("gemini");
  return out;
}

function looksLikeKey(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length >= 30;
}

/**
 * Přetížení modelu je běžný přechodný stav — u Gemini i u Claude. Bez
 * opakování by se uživateli objevila nesrozumitelná hláška u něčeho,
 * co za pár vteřin projde.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isOverloaded(e) || i === attempts - 1) throw e;
      // 1 s, pak 3 s — dost na to, aby špička opadla, ale ne aby to uživatel vzdal
      await new Promise((r) => setTimeout(r, 1000 * (1 + i * 2)));
    }
  }
  throw last;
}

export class AiOverloaded extends Error {
  constructor(provider: Provider, tries = 3) {
    const kolikrat = tries === 2 ? "dvakrát" : "třikrát";
    super(
      `${provider === "claude" ? "Claude" : "Gemini"} je právě přetížený. ` +
        `Zkusil jsem to ${kolikrat} — dej tomu chvíli a klikni znovu.`,
    );
    this.name = "AiOverloaded";
  }
}

/* ------------------------------------------------------------------ */
/* Souvislý text — shrnutí reportu                                     */
/* ------------------------------------------------------------------ */

export async function writeProse(
  provider: Provider,
  system: string,
  prompt: string,
): Promise<string> {
  return provider === "claude"
    ? writeProseClaude(system, prompt)
    : writeProseGemini(system, prompt);
}

async function writeProseClaude(system: string, prompt: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AiNotConfigured("claude");

  const client = new Anthropic({ apiKey: key });

  // Streamujeme kvůli velkému max_tokens — jinak požadavek naráží na HTTP timeout.
  const message = await withRetry(() =>
    client.beta.messages
      .stream({
        model: CLAUDE_MODEL,
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        system,
        messages: [{ role: "user", content: prompt }],
      })
      .finalMessage(),
  ).catch((e) => {
    if (isOverloaded(e)) throw new AiOverloaded("claude");
    throw e;
  });

  // Bezpečnostní klasifikátory mohou požadavek odmítnout — vrátí se HTTP 200
  // s prázdným obsahem, takže čtení content[0] bez téhle kontroly spadne.
  if (message.stop_reason === "refusal") {
    throw new AiRefused(message.stop_details?.category ?? null);
  }

  return message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("")
    .trim();
}

async function writeProseGemini(system: string, prompt: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiNotConfigured("gemini");

  const ai = new GoogleGenAI({ apiKey: key });
  try {
    const res = await withRetry(() =>
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: { systemInstruction: system },
      }),
    );
    return (res.text ?? "").trim();
  } catch (e) {
    if (isNoCredit(e)) throw new AiNoCredit();
    if (isQuotaError(e)) throw new AiQuotaExceeded("gemini", GEMINI_MODEL);
    if (isOverloaded(e)) throw new AiOverloaded("gemini");
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* Streamovaný text                                                    */
/* ------------------------------------------------------------------ */

/**
 * Totéž co `writeProse`, ale text se vydává průběžně.
 *
 * Dva důvody: hostingy omezují, jak dlouho smí serverová funkce běžet
 * (Vercel na bezplatném tarifu deset vteřin), a stream tenhle limit obchází,
 * protože odpověď začne odcházet hned. A druhý — uživatel vidí, že se něco
 * děje, místo aby minutu koukal na zamrzlé tlačítko.
 */
export async function* streamProse(
  provider: Provider,
  system: string,
  prompt: string,
): AsyncGenerator<string> {
  if (provider === "claude") {
    yield* streamClaude(system, prompt);
  } else {
    yield* streamGemini(system, prompt);
  }
}

async function* streamClaude(system: string, prompt: string): AsyncGenerator<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AiNotConfigured("claude");

  const client = new Anthropic({ apiKey: key });
  const stream = client.beta.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system,
    messages: [{ role: "user", content: prompt }],
  });

  try {
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
  } catch (e) {
    if (isOverloaded(e)) throw new AiOverloaded("claude");
    throw e;
  }

  // Bezpečnostní klasifikátory mohou požadavek odmítnout i uprostřed —
  // pak je potřeba už vydaný text zahodit, ne ho vydávat za hotový.
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    throw new AiRefused(final.stop_details?.category ?? null);
  }
}

async function* streamGemini(system: string, prompt: string): AsyncGenerator<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiNotConfigured("gemini");

  const ai = new GoogleGenAI({ apiKey: key });

  // Opakování musí obalit až samotné otevření streamu — jakmile začne
  // odcházet text, na začátek se vrátit nedá.
  const stream = await withRetry(() =>
    ai.models.generateContentStream({
      model: GEMINI_MODEL,
      contents: prompt,
      config: { systemInstruction: system },
    }),
  ).catch((e) => {
    if (isNoCredit(e)) throw new AiNoCredit();
    if (isQuotaError(e)) throw new AiQuotaExceeded("gemini", GEMINI_MODEL);
    if (isOverloaded(e)) throw new AiOverloaded("gemini");
    throw e;
  });

  for await (const chunk of stream) {
    const text = chunk.text;
    if (text) yield text;
  }
}

/* ------------------------------------------------------------------ */
/* Strukturovaný výstup — JSON podle schématu                           */
/* ------------------------------------------------------------------ */

export class AiBadResponse extends Error {
  constructor() {
    super("AI vrátila nečitelnou odpověď. Zkus to znovu.");
    this.name = "AiBadResponse";
  }
}

/**
 * Model pro krátké jednorázové úkoly (rychlý zápis). Přednost má Gemini —
 * stačí na to a dá se používat zdarma; Claude je záloha, když Gemini klíč
 * chybí. `null`, když není nastavený žádný.
 */
export function pickProvider(): Provider | null {
  const available = availableProviders();
  return available.includes("gemini") ? "gemini" : (available[0] ?? null);
}

/**
 * Jedno volání, na které se odpoví hotovým JSON podle schématu. Schéma
 * dostane Claude přes structured outputs a Gemini přes `responseJsonSchema`,
 * obojí drží odpověď v daném tvaru. Co se v tom tvaru vrátí, ale nikdo
 * nezaručuje obsahově — volající výsledek ověřuje sám.
 */
export async function extractJson(
  provider: Provider,
  system: string,
  prompt: string,
  schema: Record<string, unknown>,
): Promise<unknown> {
  const text = provider === "claude"
    ? await extractJsonClaude(system, prompt, schema)
    : await extractJsonGemini(system, prompt, schema);

  try {
    return JSON.parse(text);
  } catch {
    throw new AiBadResponse();
  }
}

async function extractJsonClaude(system: string, prompt: string, schema: Record<string, unknown>): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AiNotConfigured("claude");

  const client = new Anthropic({ apiKey: key });
  const message = await withRetry(() =>
    client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      output_config: { format: { type: "json_schema", schema } },
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  ).catch((e) => {
    if (isOverloaded(e)) throw new AiOverloaded("claude");
    throw e;
  });

  if (message.stop_reason === "refusal") {
    throw new AiRefused(message.stop_details?.category ?? null);
  }

  return message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
}

/**
 * Na přepis textu do úkolů stačí lehký model. Má dvě výhody: odpovídá za pár
 * vteřin (velký model za "vysoké poptávky" vrací 503 a ta sama trvá kolem
 * 10 s) a bezplatný limit na minutu platí pro každý model zvlášť, takže zápis
 * neubírá z kvóty shrnutí reportu. Velký model (`GEMINI_MODEL`) je záloha.
 */
const GEMINI_FAST_MODEL = process.env.GEMINI_FAST_MODEL || "gemini-3.1-flash-lite";

/**
 * Jeden pokus nesmí trvat déle — dva se musí vejít do limitu stránky (30 s).
 * Gemini kratší limit než 10 s odmítá ("Minimum allowed deadline is 10s").
 */
const ATTEMPT_TIMEOUT_MS = 10_000;

/**
 * Po jakém selhání má smysl zkusit jiný model: přetížení, vyčerpaná minutová
 * kvóta, vypršení času, nebo model, který tohle zadání nebere (404/400).
 * Chyba, která by selhala všude, tím jen zdvojí čekání — a pak se ukáže ta
 * poslední.
 */
function worthTryingAnotherModel(e: unknown): boolean {
  if (isOverloaded(e) || isQuotaError(e) || isTimeout(e)) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /"code":\s*(400|404)|not found|not supported/i.test(msg);
}

async function extractJsonGemini(system: string, prompt: string, schema: Record<string, unknown>): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiNotConfigured("gemini");

  const ai = new GoogleGenAI({ apiKey: key });
  const models = [...new Set([GEMINI_FAST_MODEL, GEMINI_MODEL])];
  let last: unknown;

  for (const model of models) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          responseJsonSchema: schema,
          // Přepis textu do úkolů žádné uvažování nepotřebuje. S výchozím
          // "přemýšlením" trvala odpověď 10–19 s, bez něj kolem 3–5 s.
          thinkingConfig: { thinkingBudget: 0 },
          httpOptions: { timeout: ATTEMPT_TIMEOUT_MS },
        },
      });
      return res.text ?? "";
    } catch (e) {
      last = e;
      if (!worthTryingAnotherModel(e)) break;
    }
  }

  if (isNoCredit(last)) throw new AiNoCredit();
  if (isQuotaError(last)) throw new AiQuotaExceeded("gemini", GEMINI_FAST_MODEL);
  if (isOverloaded(last) || isTimeout(last)) throw new AiOverloaded("gemini", models.length);
  throw last;
}
