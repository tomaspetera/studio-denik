import "server-only";

import { supabaseServer } from "./supabase/server";

/**
 * Stav pracovního prostoru přihlášeného člověka.
 *
 * `schema-missing` znamená, že v databázi ještě neproběhla migrace — appka
 * to musí umět rozeznat a poradit, ne spadnout na nesrozumitelné chybě.
 */
export type Workspace =
  | { state: "ready"; orgId: string; orgName: string; email: string; initials: string }
  | { state: "schema-missing"; email: string; detail: string }
  | { state: "error"; email: string; detail: string };

/** PostgREST hlásí chybějící tabulku i funkci vlastními kódy. */
function isSchemaMissing(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  const code = err.code ?? "";
  const msg = err.message ?? "";
  return (
    code === "PGRST202" ||          // funkce není ve schema cache
    code === "PGRST205" ||          // tabulka není ve schema cache
    code === "42P01" ||             // undefined_table
    /schema cache|does not exist/i.test(msg)
  );
}

export async function getWorkspace(): Promise<Workspace | null> {
  const supabase = await supabaseServer();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const email = user.email ?? "";

  // Bezpečné volat pokaždé — když prostor existuje, jen vrátí jeho id.
  //
  // `p_name` posíláme výslovně, i když má v SQL výchozí hodnotu: PostgREST
  // hledá funkci podle přesné sady parametrů, takže volání bez argumentů by
  // hledalo bezparametrickou variantu, která neexistuje.
  const { data: orgId, error } = await supabase.rpc("ensure_workspace", {
    p_name: null,
  });

  if (error) {
    return isSchemaMissing(error)
      ? { state: "schema-missing", email, detail: error.message }
      : { state: "error", email, detail: error.message };
  }

  const { data: org, error: orgErr } = await supabase
    .from("orgs")
    .select("id, name")
    .eq("id", orgId)
    .single();

  if (orgErr || !org) {
    return {
      state: "error",
      email,
      detail: orgErr?.message ?? "Pracovní prostor se nepodařilo načíst.",
    };
  }

  const local = email.split("@")[0] || "?";

  return {
    state: "ready",
    orgId: org.id,
    orgName: org.name,
    email,
    initials: local.slice(0, 2).toUpperCase(),
  };
}
