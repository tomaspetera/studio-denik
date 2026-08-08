import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

/**
 * Napojení na AI. Běží výhradně na serveru — `server-only` zajistí, že se
 * tenhle modul nedá omylem naimportovat do klientské komponenty a klíče
 * neskončí v prohlížeči.
 */

export type Provider = "claude" | "gemini";

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

// Bezplatná úroveň Gemini nemá kvótu na `pro` modely — ty vracejí 429 hned
// při prvním požadavku. `flash` funguje a na psaní reportu bohatě stačí.
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

function isQuotaError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /RESOURCE_EXHAUSTED|quota|rate.?limit|"code":\s*429/i.test(msg);
}

/** Model je momentálně přetížený. Na rozdíl od vyčerpané kvóty to přejde. */
function isOverloaded(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /UNAVAILABLE|overloaded|high demand|"code":\s*(503|529)/i.test(msg);
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
  constructor(provider: Provider) {
    super(
      `${provider === "claude" ? "Claude" : "Gemini"} je právě přetížený. ` +
        "Zkusil jsem to třikrát — dej tomu chvíli a klikni znovu.",
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
/* Rychlý zápis — z věty strukturovaný úkol                            */
/* ------------------------------------------------------------------ */

export type ParsedTask = {
  title: string;
  client: string | null;
  supplier: string | null;
  category: string | null;
  kind: "interni" | "klient" | "tisk";
  step: number;
  due_at: string | null;
  size: 1 | 2 | 3;
  note: string | null;
};

/**
 * Schéma popisujeme jednou a posíláme oběma poskytovatelům. Claude ho dostane
 * přes structured outputs, Gemini přes responseSchema — obojí garantuje, že
 * odpověď půjde rozparsovat, takže nepotřebujeme retry smyčku kolem JSON.parse.
 */
const TASK_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Stručný název úkolu, bez uvozovek." },
    client: { type: ["string", "null"], description: "Jméno klienta, pokud zaznělo." },
    supplier: { type: ["string", "null"], description: "Dodavatel nebo tiskárna, pokud zazněla." },
    category: { type: ["string", "null"], description: "Např. Grafika, Tisk, Administrativa, Web." },
    kind: {
      type: "string",
      enum: ["interni", "klient", "tisk"],
      description:
        "tisk = jde do tiskárny; klient = klient to schvaluje; interni = nikdo zvenčí do toho nevstupuje.",
    },
    step: {
      type: "integer",
      description:
        "Index kroku, na kterém úkol stojí. interni 0-2, klient 0-3, tisk 0-5. 0 = zadáno.",
    },
    due_at: { type: ["string", "null"], description: "Termín v ISO 8601, nebo null." },
    size: { type: "integer", enum: [1, 2, 3], description: "1 malý, 2 střední, 3 velký." },
    note: { type: ["string", "null"], description: "Doplňující poznámka, nebo null." },
  },
  required: ["title", "client", "supplier", "category", "kind", "step", "due_at", "size", "note"],
  additionalProperties: false,
} as const;

const PARSE_SYSTEM = `Převádíš české věty o odvedené práci na strukturovaný úkol pro grafické studio.
Dnešní datum dostaneš v zadání — relativní termíny ("do pátku", "příští týden") podle něj převeď na konkrétní datum.
Když něco nezaznělo, vrať null. Nic si nedomýšlej.`;

export async function parseTask(
  provider: Provider,
  sentence: string,
  today: Date,
): Promise<ParsedTask> {
  const prompt = `Dnešní datum: ${today.toISOString()}\n\nVěta: ${sentence}`;
  return provider === "claude"
    ? parseTaskClaude(prompt)
    : parseTaskGemini(prompt);
}

async function parseTaskClaude(prompt: string): Promise<ParsedTask> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AiNotConfigured("claude");

  const client = new Anthropic({ apiKey: key });
  const message = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4000,
    output_config: { format: { type: "json_schema", schema: TASK_SCHEMA } },
    system: PARSE_SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });

  if (message.stop_reason === "refusal") {
    throw new AiRefused(message.stop_details?.category ?? null);
  }

  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");

  return JSON.parse(text) as ParsedTask;
}

async function parseTaskGemini(prompt: string): Promise<ParsedTask> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiNotConfigured("gemini");

  const ai = new GoogleGenAI({ apiKey: key });
  try {
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        systemInstruction: PARSE_SYSTEM,
        responseMimeType: "application/json",
        responseSchema: TASK_SCHEMA as unknown as Record<string, unknown>,
      },
    });
    return JSON.parse(res.text ?? "{}") as ParsedTask;
  } catch (e) {
    if (isQuotaError(e)) throw new AiQuotaExceeded("gemini", GEMINI_MODEL);
    throw e;
  }
}
