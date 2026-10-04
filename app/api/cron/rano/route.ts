import webpush from "web-push";
import { supabaseAdmin } from "@/lib/supabase/server";
import { dateKeyUTC, todayKeyPrague, addDaysKey } from "@/lib/domain";
import { loadAttention } from "@/lib/attention-data";
import { actionableCount, isValidDateKey } from "@/lib/attention";
import { syncMailboxesForCron } from "@/lib/mail-data";
import { isMailAutoDay, morningPushBody } from "@/lib/mail-schedule";

/**
 * Ranní souhrn — jednou denně, přes Vercel Cron (viz vercel.json).
 *
 * Hobby tarif dovoluje cron spustit jen jednou za den a bez záruky přesné
 * hodiny (kdykoli v rámci té hodiny) — přesně to sem patří, protože se
 * hlásí termíny na den, ne na hodinu.
 *
 * Neposílá se nikomu, komu zrovna nic nehoří — souhrn "0 po termínu, 0 dnes"
 * by za pár dní skončil jen jako otravné oznámení, které si každý ztiší.
 *
 * V úterý, ve středu a ve čtvrtek se před souhrnem načte i pošta — jen
 * schránkám, jejichž majitel si ranní načítání zapnul (`lib/mail-schedule.ts`,
 * `syncMailboxesForCron`). Kolik zpráv čeká, se pak dozví jen on sám: pošta
 * je soukromá, do upozornění kolegům nepatří.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Kolik času smí zabrat pošta, aby zbylo na souhrn a rozeslání. */
const POSTA_NEJDELE_MS = 40_000;

const VYVOJ = process.env.NODE_ENV !== "production";

/**
 * Vývojový server běží nad stejnou databází jako ostrý provoz. Ranní běh
 * spuštěný na něm by rozeslal skutečná upozornění a skutečné schránky načetl
 * proti místní atrapě Gmailu. Ve vývoji proto sahá jen na jedno zkušební
 * studio (`CRON_TEST_ORG`) — a bez něj neudělá nic.
 */
function zkusebniStudio(): string | null {
  return (VYVOJ && process.env.CRON_TEST_ORG) || null;
}

/**
 * Při vývoji jde dnešek podvrhnout (`CRON_TEST_TODAY`), aby šlo ranní načtení
 * pošty vyzkoušet i mimo úterý až čtvrtek. V ostrém provozu se to ignoruje.
 */
function dnesniDen(): string {
  const zkusebni = VYVOJ ? process.env.CRON_TEST_TODAY : undefined;
  return zkusebni && isValidDateKey(zkusebni) ? zkusebni : todayKeyPrague();
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const jenStudio = zkusebniStudio();
  if (VYVOJ && !jenStudio) {
    return Response.json({ skipped: "Ve vývoji běží ranní souhrn jen nad zkušebním studiem (CRON_TEST_ORG)." });
  }

  const zacatek = Date.now();
  const supabase = supabaseAdmin();
  const today = dnesniDen();
  const tomorrow = addDaysKey(today, 1);

  // Pošta první, ať se do upozornění dostanou čerstvé počty. Na klíčích pro
  // upozornění nezávisí — načte se, i kdyby se nic neposílalo.
  const posta = isMailAutoDay(today) ? await syncMailboxesForCron(supabase, zacatek + POSTA_NEJDELE_MS, jenStudio) : null;
  // Do odpovědi jen počty schránek — nic z pošty samotné.
  const mail = posta ? { synced: posta.synced, failed: posta.failed, skipped: posta.skipped } : null;

  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (!vapidPublic || !vapidPrivate) {
    return Response.json({ skipped: "VAPID klíče nejsou nastavené.", mail });
  }

  webpush.setVapidDetails(
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://studio-denik.vercel.app",
    vapidPublic,
    vapidPrivate,
  );

  const vsechna = supabase.from("orgs").select("id");
  const { data: orgs } = await (jenStudio ? vsechna.eq("id", jenStudio) : vsechna);

  let notified = 0;
  let cleaned = 0;

  for (const org of orgs ?? []) {
    // Opakované úkoly se zakládají první, ať se promítnou i do dnešního
    // souhrnu. Dva dny zpět dožene výpadek (ranní běh, který jednou
    // nevyšel); záznam o výskytu v databázi hlídá, aby nic nevzniklo
    // dvakrát. Chyba tu nesmí shodit celý běh — push se pošle i bez toho.
    await supabase.rpc("create_due_recurring_tasks", {
      p_org: org.id as string,
      p_today: today,
      p_days_back: 2,
    });

    const { data: tasks } = await supabase
      .from("tasks_view")
      .select("ball, is_late, due_at")
      .eq("org_id", org.id as string);

    type Row = { ball: string; is_late: boolean; due_at: string | null };
    const rows = (tasks ?? []) as Row[];

    const overdue = rows.filter((t) => t.is_late).length;
    const dueToday = rows.filter((t) => t.ball !== "done" && !t.is_late && t.due_at && dateKeyUTC(t.due_at) === today).length;
    const dueTomorrow = rows.filter((t) => t.ball !== "done" && t.due_at && dateKeyUTC(t.due_at) === tomorrow).length;

    // Do pushe jen to, co si člověk sám slíbil nebo nechal ležet (viz
    // `actionableCount`) — ticho u klienta se ukazuje jen na Dnes.
    const attention = actionableCount((await loadAttention(supabase, org.id as string, today)).items);

    const parts: string[] = [];
    if (dueToday > 0) parts.push(`dnes končí ${dueToday}`);
    if (dueTomorrow > 0) parts.push(`zítra ${dueTomorrow}`);
    if (overdue > 0) parts.push(`po termínu ${overdue}`);
    if (attention > 0) parts.push(`chce pozornost ${attention}`);

    // Bez úkolů má smysl pokračovat jen tehdy, když někomu čeká pošta.
    if (parts.length === 0 && !posta?.counts.size) continue;

    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .eq("org_id", org.id as string);
    if (!subs?.length) continue;

    for (const s of subs) {
      // Počet čekajících zpráv jen majiteli schránky, nikomu dalšímu ze studia.
      const body = morningPushBody(parts, posta?.counts.get(s.user_id as string));
      if (!body) continue;

      const payload = JSON.stringify({ title: "Studio Deník", body, url: "/" });

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

  return Response.json({ notified, cleaned, mail });
}
