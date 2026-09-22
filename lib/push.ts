import "server-only";

import { supabaseServer } from "./supabase/server";

/**
 * Odběrné místo (subscription) na zařízení, ne na uživatele — člověk
 * přihlášený na mobilu i na počítači dostane upozornění na obou, dokud si
 * to na tom kterém zařízení sám nevypne. Řádková práva jsou tu záměrně užší
 * než ve zbytku appky (kdokoli s právem editovat smí sáhnout na cizí úkol,
 * ale ne na cizí odběr push notifikací) — je to nastavení konkrétního
 * zařízení, ne provozní data studia.
 */
export type ActionResult = { ok: true } | { ok: false; message: string };

export async function saveSubscription(input: {
  orgId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Nepřihlášený uživatel." };

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      org_id: input.orgId,
      user_id: user.id,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
    },
    { onConflict: "endpoint" },
  );

  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function removeSubscription(endpoint: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
