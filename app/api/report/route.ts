import { getWorkspace } from "@/lib/workspace";
import { streamSummary } from "@/lib/report";
import { ERROR_MARK } from "@/lib/stream-marks";
import type { Provider } from "@/lib/ai";

/**
 * Generování reportu.
 *
 * Běží jako streamovaná trasa, ne jako serverová akce: hostingy omezují,
 * jak dlouho smí funkce běžet (Vercel na bezplatném tarifu deset vteřin),
 * a stream ten limit obchází, protože odpověď začne odcházet okamžitě.
 * Uživatel navíc vidí text vznikat, místo aby čekal na zamrzlé tlačítko.
 */
/**
 * Model občas začne odpovídat až po osmi vteřinách — a to je na výchozí
 * limit deseti vteřin příliš těsné. Vercel tuhle hodnotu respektuje
 * a na bezplatném tarifu povoluje až šedesát.
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  const ws = await getWorkspace();
  if (!ws) {
    return new Response("Nepřihlášený uživatel.", { status: 401 });
  }
  if (ws.state !== "ready") {
    return new Response("Pracovní prostor není připravený.", { status: 409 });
  }

  let provider: Provider | undefined;
  try {
    const body = (await request.json()) as { provider?: Provider };
    provider = body.provider;
  } catch {
    // Tělo je nepovinné — bez něj se vezme první dostupný model.
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const piece of streamSummary(ws.orgId, provider)) {
          controller.enqueue(encoder.encode(piece));
        }
      } catch (e) {
        // Chybu už nejde poslat stavovým kódem — hlavička dávno odešla.
        // Vydáme ji tedy uvozenou znakem, který se v textu vyskytnout
        // nemůže, takže ho nelze splést s obsahem reportu.
        const message = e instanceof Error ? e.message : String(e);
        controller.enqueue(encoder.encode(ERROR_MARK + message));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      // Vypne vyrovnávací paměť u zpětných proxy — jinak by stream dorazil
      // až celý najednou a byl by k ničemu.
      "X-Accel-Buffering": "no",
    },
  });
}
