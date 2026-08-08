import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Klient pro serverové komponenty a akce. Jede pod přihlášeným uživatelem,
 * takže se na něj vztahují přístupová práva v databázi — dotaz nikdy nevrátí
 * data z cizí organizace, ani kdyby v kódu chyběl filtr.
 */
export async function supabaseServer() {
  const store = await cookies();

  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) {
              store.set(name, value, options);
            }
          } catch {
            // V serverové komponentě se cookies zapisovat nedají. Obnovu
            // relace řeší middleware, takže je bezpečné to tady přejít.
          }
        },
      },
    },
  );
}

/**
 * Klient obcházející všechna přístupová práva. Používat jen tam, kde žádný
 * přihlášený uživatel neexistuje a přístup se ověřuje jinak — konkrétně
 * u veřejné stránky sdíleného reportu, kde je klíčem token z odkazu.
 */
export function supabaseAdmin() {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Chybí proměnná ${name}. Zkopíruj .env.local.example jako .env.local a vyplň ji.`,
    );
  }
  return value;
}
