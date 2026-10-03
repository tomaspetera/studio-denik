/**
 * Rozpoznání chyb od poskytovatelů AI.
 *
 * Čisté funkce bez závislostí, aby šly otestovat bez sítě: knihovny vracejí
 * chybu jako text (často s vloženým JSON) a k němu stavový kód HTTP, a podle
 * toho se rozhoduje, jestli má smysl zkusit to znovu, zkusit jiný model,
 * nebo člověku rovnou říct, co se stalo.
 */

function text(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function httpStatus(e: unknown): unknown {
  return typeof e === "object" && e !== null ? (e as { status?: unknown }).status : undefined;
}

/**
 * Došel předplacený kredit (HTTP 402). Nepomůže opakování ani jiný model —
 * dokud se kredit nedobije, selže každé volání.
 */
export function isNoCredit(e: unknown): boolean {
  return httpStatus(e) === 402 || /"code":\s*402\b|payment required/i.test(text(e));
}

/** Vyčerpaná kvóta nebo limit požadavků za minutu. */
export function isQuotaError(e: unknown): boolean {
  return /RESOURCE_EXHAUSTED|quota|rate.?limit|"code":\s*429/i.test(text(e));
}

/** Model je momentálně přetížený. Na rozdíl od vyčerpané kvóty to přejde. */
export function isOverloaded(e: unknown): boolean {
  return /UNAVAILABLE|overloaded|high demand|"code":\s*(503|529)/i.test(text(e));
}

export function isTimeout(e: unknown): boolean {
  return /timeout|timed out|aborted|AbortError/i.test(text(e));
}
