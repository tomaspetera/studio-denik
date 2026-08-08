"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Klient pro prohlížeč. Dostane jen veřejný `anon` klíč. */
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
