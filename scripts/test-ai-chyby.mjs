/**
 * Rozpoznání chyb od AI — bez sítě. Podle něj appka rozhoduje, jestli to
 * zkusit znovu, zkusit jiný model, nebo člověku říct, co se stalo.
 *
 * Nejdůležitější je „došel kredit“: taková chyba se nesmí splést s běžným
 * limitem (ten za minutu přejde sám), jinak by appka radila počkat u něčeho,
 * co počkáním nezmizí.
 */
import { isNoCredit, isOverloaded, isQuotaError, isTimeout } from "../lib/ai-errors.ts";

let chyby = 0;
const ok = (s) => console.log("  " + s);
const zkouska = (nazev, cond, popis) => {
  if (cond) ok(`${nazev.padEnd(28)}ok — ${popis}`);
  else { chyby++; ok(`${nazev.padEnd(28)}ŠPATNĚ — ${popis}`); }
};

/** Chyba ve tvaru, v jakém ji vrací knihovna Gemini: text s JSON a stavový kód. */
const apiChyba = (status, message) => Object.assign(new Error(message), { name: "ApiError", status });

const kredit = apiChyba(402, '{"error":{"code":402,"message":"Your prepayment credits are depleted.","status":"FAILED_PRECONDITION"}}');
const limit = apiChyba(429, '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.","status":"RESOURCE_EXHAUSTED"}}');
const pretizeni = apiChyba(503, '{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}');

zkouska("kredit: stavový kód", isNoCredit(kredit), "HTTP 402 od knihovny");
zkouska("kredit: jen text", isNoCredit(new Error('got status: 402 Payment Required. {"error":{"code": 402}}')), "kód uvnitř textu chyby");
zkouska("kredit: jen kód", isNoCredit({ status: 402 }) && isNoCredit("402 Payment Required"), "i když chyba není Error");
zkouska("kredit není limit", !isQuotaError(kredit) && !isOverloaded(kredit) && !isTimeout(kredit), "došlý kredit se neplete s ničím přechodným");

zkouska("limit", isQuotaError(limit) && !isNoCredit(limit), "limit zmiňuje „billing“, ale kredit to není");
zkouska("přetížení", isOverloaded(pretizeni) && !isNoCredit(pretizeni) && !isQuotaError(pretizeni), "503 je přechodný stav");
zkouska("přetížení Claude", isOverloaded(new Error('{"type":"error","error":{"type":"overloaded_error"}}')), "529 u druhého poskytovatele");
zkouska("vypršení času", isTimeout(new Error("The operation was aborted due to timeout")) && isTimeout(new Error("AbortError")), "obě podoby");

zkouska("podobné číslo", !isNoCredit(new Error('{"error":{"code": 4020}}')) && !isNoCredit({ status: 4020 }) && !isNoCredit({ status: "402" }), "4020 ani text „402“ ve stavu kredit není");
zkouska("jiná chyba", !isNoCredit(new Error("fetch failed")) && !isQuotaError(new Error("fetch failed")) && !isOverloaded(new Error("fetch failed")) && !isTimeout(new Error("fetch failed")), "obecná chyba sítě není nic z toho");
zkouska("prázdný vstup", !isNoCredit(null) && !isNoCredit(undefined) && !isQuotaError(null) && !isOverloaded(undefined) && !isTimeout({}), "null a spol. nespadnou");

// Žádná otevřená spojení, proces doběhne sám.
console.log(chyby === 0 ? "\nRozpoznání chyb AI drží." : `\nProblémů: ${chyby}`);
process.exitCode = chyby === 0 ? 0 : 1;
