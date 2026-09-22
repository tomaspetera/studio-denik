import webpush from "web-push";
import { supabaseAdmin } from "@/lib/supabase/server";
import { dateKeyUTC, todayKeyPrague, addDaysKey } from "@/lib/domain";

/**
 * Ranní souhrn — jednou denně, přes Vercel Cron (viz vercel.json).
 *
 * Hobby tarif dovoluje cron spustit jen jednou za den a bez záruky přesné
 * hodiny (kdykoli v rámci té hodiny) — přesně to sem patří, protože se
 * hlásí termíny na den, ne na hodinu.
 *
 * Neposílá se nikomu, komu zrovna nic nehoří — souhrn "0 po termínu, 0 dnes"
 * by za pár dní skončil jen jako otravné oznámení, které si každý ztiší.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (!vapidPublic || !vapidPrivate) {
    return Response.json({ skipped: "VAPID klíče nejsou nastavené." });
  }

  webpush.setVapidDetails(
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://studio-denik.vercel.app",
    vapidPublic,
    vapidPrivate,
  );

  const supabase = supabaseAdmin();
  const today = todayKeyPrague();
  const tomorrow = addDaysKey(today, 1);

  const { data: orgs } = await supabase.from("orgs").select("id");

  let notified = 0;
  let cleaned = 0;

  for (const org of orgs ?? []) {
    const { data: tasks } = await supabase
      .from("tasks_view")
      .select("ball, is_late, due_at")
      .eq("org_id", org.id as string);

    type Row = { ball: string; is_late: boolean; due_at: string | null };
    const rows = (tasks ?? []) as Row[];

    const overdue = rows.filter((t) => t.is_late).length;
    const dueToday = rows.filter((t) => t.ball !== "done" && !t.is_late && t.due_at && dateKeyUTC(t.due_at) === today).length;
    const dueTomorrow = rows.filter((t) => t.ball !== "done" && t.due_at && dateKeyUTC(t.due_at) === tomorrow).length;

    if (overdue === 0 && dueToday === 0 && dueTomorrow === 0) continue;

    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("org_id", org.id as string);
    if (!subs?.length) continue;

    const parts: string[] = [];
    if (dueToday > 0) parts.push(`dnes končí ${dueToday}`);
    if (dueTomorrow > 0) parts.push(`zítra ${dueTomorrow}`);
    if (overdue > 0) parts.push(`po termínu ${overdue}`);

    const payload = JSON.stringify({
      title: "Studio Deník",
      body: parts.join(" · "),
      url: "/",
    });

    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint as string, keys: { p256dh: s.p256dh as string, auth: s.auth as string } },
          payload,
        );
        notified++;
      } catch (e) {
        // 404/410 = odběr už neplatí (odhlášený prohlížeč, smazaná appka…) —
        // úklid rovnou tady, ať se příště nezkouší znovu nadarmo.
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", s.id as string);
          cleaned++;
        }
      }
    }
  }

  return Response.json({ notified, cleaned });
}
