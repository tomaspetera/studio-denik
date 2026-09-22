import { loadCalendarFeedIcs } from "@/lib/calendar";

/**
 * ICS odběr pro Google/Apple Kalendář.
 *
 * Volá to cizí kalendářová appka bez přihlášení — proto je trasa v
 * `proxy.ts` výslovně veřejná a celá ochrana leží na tokenu, který zná
 * jen ten, komu ho studio dá. Stejný princip jako u schvalovacího odkazu.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const ics = await loadCalendarFeedIcs(token);

  if (!ics) {
    return new Response("Odkaz není platný.", { status: 404 });
  }

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="studio-denik.ics"',
      // Google i Apple si feed stahují samy a pravidelně — 15 minut stačí,
      // aby změna termínu dorazila brzy, a zároveň to nezatěžuje databázi
      // při každém jejich dotazu.
      "Cache-Control": "public, max-age=900",
    },
  });
}
