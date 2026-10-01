/**
 * Limity rychlého zápisu. Samostatný soubor bez závislostí, protože je
 * potřebuje i formulář v prohlížeči — a `capture.ts` tahá `zod`, který tam
 * nemá co dělat.
 */
export const CAPTURE_MAX_CHARS = 4000;
export const CAPTURE_MAX_TASKS = 15;
/** Strop při zakládání — víc než návrh ukáže, kdyby někdo posílal žádost mimo formulář. */
export const CREATE_MAX_TASKS = 50;
