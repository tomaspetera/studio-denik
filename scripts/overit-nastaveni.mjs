/**
 * Ověří, že je aplikace správně nastavená: připojení k databázi, doběhlé
 * schéma, shodu doménového pravidla mezi SQL a TypeScriptem a dostupnost AI.
 *
 * Spuštění:  npm run overit
 *
 * Nikdy nevypisuje hodnoty klíčů — jen jestli fungují.
 */
import { createClient } from "@supabase/supabase-js";

const ok = (s) => `  ${s}`;
let problemy = 0;

/* ---------------------------------------------------------------- */
console.log("=== SUPABASE ===");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !secret) {
  console.log(ok("chybí NEXT_PUBLIC_SUPABASE_URL nebo SUPABASE_SERVICE_ROLE_KEY"));
  process.exit(1);
}

const db = createClient(url, secret, { auth: { persistSession: false } });

const TABULKY = [
  "orgs", "profiles", "memberships", "clients", "suppliers",
  "categories", "tasks", "print_jobs", "task_events", "reports", "tasks_view",
];

// Skutečné čtení, ne HEAD — HEAD dotaz projde i tehdy, když PostgREST
// tabulku ve své cache nemá, a kontrola by byla falešně pozitivní.
for (const t of TABULKY) {
  const { error } = await db.from(t).select("*").limit(1);
  if (error) {
    problemy++;
    console.log(ok(`${t.padEnd(13)} CHYBÍ — ${error.message}`));
  } else {
    console.log(ok(`${t.padEnd(13)} ok`));
  }
}

/* ---------------------------------------------------------------- */
console.log("\n=== SHODA PRAVIDLA „u koho leží míč“ ===");

// Pravidlo je zapsané dvakrát — v SQL jako `ball_of` a v lib/domain.ts jako
// `ballOf`. Kdyby se rozešly, aplikace by ukazovala jiný stav, než na jakém
// stojí přístupová práva a reporty.
//
// Neměříme funkci přes RPC (Supabase ji přes REST nevystavuje), ale přes
// pohled `tasks_view` — tedy přesně tou cestou, kterou data čte aplikace.
// Založíme dočasnou organizaci, porovnáme, a zase ji smažeme.
const OCEKAVANO = {
  interni: ["me", "me", "done"],
  klient: ["me", "me", "client", "done"],
  tisk: ["me", "me", "client", "supplier", "me", "done"],
};

let neshody = 0;
let orgId = null;

try {
  const { data: org, error: orgErr } = await db
    .from("orgs")
    .insert({ name: "__test_overeni__", slug: `__test_${Date.now()}` })
    .select("id")
    .single();
  if (orgErr) throw orgErr;
  orgId = org.id;

  const radky = [];
  for (const [kind, kroky] of Object.entries(OCEKAVANO)) {
    for (let step = 0; step < kroky.length; step++) {
      radky.push({ org_id: orgId, title: `${kind}-${step}`, kind, step });
    }
  }

  const { error: insErr } = await db.from("tasks").insert(radky);
  if (insErr) throw insErr;

  const { data: view, error: viewErr } = await db
    .from("tasks_view")
    .select("title, kind, step, ball, step_name, step_count")
    .eq("org_id", orgId);
  if (viewErr) throw viewErr;

  const podleTitulku = new Map(view.map((r) => [r.title, r]));
  let porovnano = 0;

  for (const [kind, kroky] of Object.entries(OCEKAVANO)) {
    for (let step = 0; step < kroky.length; step++) {
      const r = podleTitulku.get(`${kind}-${step}`);
      porovnano++;
      if (!r) {
        neshody++;
        console.log(ok(`${kind}[${step}] — řádek se nevrátil`));
      } else if (r.ball !== kroky[step]) {
        neshody++;
        console.log(ok(`NESHODA ${kind}[${step}]: databáze "${r.ball}", TypeScript "${kroky[step]}"`));
      } else if (r.step_count !== kroky.length) {
        neshody++;
        console.log(ok(`NESHODA ${kind}: databáze má ${r.step_count} kroků, TypeScript ${kroky.length}`));
      }
    }
  }

  if (neshody === 0) {
    console.log(ok(`všech ${porovnano} kroků sedí — databáze a TypeScript se shodují`));
    const ukazka = podleTitulku.get("tisk-3");
    console.log(ok(`ukázka: tiskový úkol na kroku 3 = "${ukazka.step_name}", míč u ${ukazka.ball}`));
  }
} catch (e) {
  neshody++;
  console.log(ok(`nelze ověřit — ${String(e?.message ?? e).slice(0, 200)}`));
} finally {
  // Úklid. Smazání organizace kaskádou odstraní i testovací úkoly.
  if (orgId) {
    const { error } = await db.from("orgs").delete().eq("id", orgId);
    console.log(ok(error ? `ÚKLID SELHAL, smaž ručně org ${orgId}` : "testovací data uklizena"));
  }
}

problemy += neshody;

/* ---------------------------------------------------------------- */
console.log("\n=== AI ===");

const anthropicKey = process.env.ANTHROPIC_API_KEY ?? "";
const geminiKey = process.env.GEMINI_API_KEY ?? "";

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

if (geminiKey.length >= 30) {
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: geminiKey });
    const r = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: "Odpověz jediným slovem: funguje",
    });
    console.log(ok(`Gemini   ok (${GEMINI_MODEL}) — odpověděl: ${JSON.stringify((r.text ?? "").trim().slice(0, 30))}`));
  } catch (e) {
    problemy++;
    const msg = String(e?.message ?? e);
    console.log(
      ok(
        /RESOURCE_EXHAUSTED|quota|429/i.test(msg)
          ? `Gemini   vyčerpaná kvóta pro ${GEMINI_MODEL} — zkus jiný model přes GEMINI_MODEL`
          : `Gemini   CHYBA — ${msg.slice(0, 180)}`,
      ),
    );
  }
} else if (geminiKey) {
  console.log(ok(`Gemini   klíč má jen ${geminiKey.length} znaků — zástupný text`));
} else {
  console.log(ok("Gemini   klíč nevyplněn"));
}

if (!anthropicKey) {
  console.log(ok("Claude   klíč nevyplněn"));
} else if (anthropicKey.length < 40) {
  console.log(ok(`Claude   klíč má jen ${anthropicKey.length} znaků — zástupný text, ne skutečný klíč`));
} else {
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: anthropicKey });
    const m = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 16,
      messages: [{ role: "user", content: "Odpověz jediným slovem: funguje" }],
    });
    const text = m.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    console.log(ok(`Claude   ok — odpověděl: ${JSON.stringify(text.trim().slice(0, 30))}`));
  } catch (e) {
    problemy++;
    console.log(ok(`Claude   CHYBA — ${String(e?.message ?? e).slice(0, 200)}`));
  }
}

/* ---------------------------------------------------------------- */
console.log(
  problemy === 0
    ? "\nVšechno v pořádku."
    : `\nNalezeno problémů: ${problemy}`,
);
process.exit(problemy === 0 ? 0 : 1);
