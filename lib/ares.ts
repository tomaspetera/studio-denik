/**
 * Dohledání firmy v ARESu — veřejném registru ekonomických subjektů.
 *
 * Kontrolní číslice se počítá tady, ještě před dotazem. Překlep v IČO je
 * mnohem častější než neexistující firma, a tenhle výpočet ho odhalí
 * okamžitě, bez čekání na odpověď.
 *
 * Bez `server-only`: kontrolu čísla potřebuje i formulář v prohlížeči,
 * aby uměl zašedit tlačítko dřív, než se na cokoliv klikne.
 */

const ENDPOINT = "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty";

export type AresCompany = {
  ico: string;
  name: string;
  dic: string | null;
  address: string | null;
};

export type AresResult =
  | { ok: true; company: AresCompany }
  | { ok: false; message: string };

/** Zbaví IČO mezer a doplní vedoucí nuly — lidé je běžně vynechávají. */
export function normalizeIco(input: string): string {
  const digits = input.replace(/\D/g, "");
  return digits.length > 0 && digits.length < 8 ? digits.padStart(8, "0") : digits;
}

/**
 * Kontrolní číslice IČO (modulo 11).
 *
 * Prvních sedm číslic se váží osmi až dvěma, součet se dělí jedenácti
 * a ze zbytku vyjde osmá číslice. Zbytek 0 dává 1, zbytek 1 dává 0 —
 * jinak jedenáct mínus zbytek.
 */
export function isValidIco(input: string): boolean {
  const ico = normalizeIco(input);
  if (!/^\d{8}$/.test(ico)) return false;

  let sum = 0;
  for (let i = 0; i < 7; i++) {
    sum += Number(ico[i]) * (8 - i);
  }

  const rest = sum % 11;
  const check = rest === 0 ? 1 : rest === 1 ? 0 : 11 - rest;

  return check === Number(ico[7]);
}

export async function lookupAres(input: string): Promise<AresResult> {
  const ico = normalizeIco(input);

  if (!/^\d{8}$/.test(ico)) {
    return { ok: false, message: "IČO má osm číslic." };
  }
  if (!isValidIco(ico)) {
    return { ok: false, message: "Tohle IČO neexistuje — nesedí kontrolní číslice. Překlep?" };
  }

  try {
    // ARES občas odpovídá pomalu; deset vteřin je víc než dost a uživatel
    // nezůstane viset na zamrzlém tlačítku.
    const res = await fetch(`${ENDPOINT}/${ico}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });

    if (res.status === 404) {
      return { ok: false, message: "V rejstříku nikdo s tímhle IČO není." };
    }
    if (!res.ok) {
      return { ok: false, message: `ARES odpověděl chybou ${res.status}. Zkus to za chvíli.` };
    }

    const data = (await res.json()) as {
      ico?: string;
      obchodniJmeno?: string;
      dic?: string;
      sidlo?: { textovaAdresa?: string };
    };

    if (!data.obchodniJmeno) {
      return { ok: false, message: "ARES vrátil záznam bez názvu firmy." };
    }

    return {
      ok: true,
      company: {
        ico: data.ico ?? ico,
        name: data.obchodniJmeno.trim(),
        dic: data.dic?.trim() || null,
        address: data.sidlo?.textovaAdresa?.trim() || null,
      },
    };
  } catch (e) {
    const timeout = e instanceof Error && /timeout|abort/i.test(e.name + e.message);
    return {
      ok: false,
      message: timeout
        ? "ARES neodpověděl včas. Zkus to znovu, nebo klienta vyplň ručně."
        : "Na ARES se nepodařilo připojit. Klienta můžeš vyplnit ručně.",
    };
  }
}
