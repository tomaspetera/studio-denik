/** Ověří, jestli jdou zakládat řádky s náhodným tokenem (clients, reports). */
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

let orgId = null;
try {
  const { data: org, error } = await db
    .from("orgs")
    .insert({ name: "__test_tokeny__", slug: `__t_${Date.now()}` })
    .select("id")
    .single();
  if (error) throw error;
  orgId = org.id;

  // clients.share_token má default encode(gen_random_bytes(12),'hex')
  const { data: c, error: cErr } = await db
    .from("clients")
    .insert({ org_id: orgId, name: "Zkušební klient" })
    .select("id, share_token")
    .single();
  if (cErr) throw new Error(`clients: ${cErr.message}`);
  console.log(`  clients  ok — token: ${c.share_token} (${c.share_token.length} znaků)`);

  // reports.share_token má default encode(gen_random_bytes(16),'hex')
  const { data: r, error: rErr } = await db
    .from("reports")
    .insert({ org_id: orgId, starts_on: "2026-08-03", ends_on: "2026-08-09", label: "test" })
    .select("id, share_token, share_until")
    .single();
  if (rErr) throw new Error(`reports: ${rErr.message}`);
  console.log(`  reports  ok — token: ${r.share_token} (${r.share_token.length} znaků)`);

  console.log("\n  Náhodné tokeny fungují. Žádná oprava není potřeba.");
} catch (e) {
  console.log(`  CHYBA — ${String(e?.message ?? e)}`);
  console.log("\n  Tokeny nefungují, schéma potřebuje opravu.");
} finally {
  if (orgId) {
    const { error } = await db.from("orgs").delete().eq("id", orgId);
    console.log(error ? `  úklid selhal: ${error.message}` : "  testovací data uklizena");
  }
}
