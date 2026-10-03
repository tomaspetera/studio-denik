/**
 * Šifrování uloženého přihlášení ke Gmailu. Bezpečnostně citlivé, proto
 * zvlášť: musí platit, že se bez klíče nedá přečíst a že se pozná porušený
 * nebo podvržený záznam.
 */
import { randomBytes } from "node:crypto";
import { encryptToken, decryptToken } from "../lib/mail-crypto.ts";

let chyby = 0;
const ok = (s) => console.log("  " + s);
const zkouska = (nazev, cond, popis) => {
  if (cond) ok(`${nazev.padEnd(24)}ok — ${popis}`);
  else { chyby++; ok(`${nazev.padEnd(24)}ŠPATNĚ — ${popis}`); }
};
const hodi = (fn) => { try { fn(); return false; } catch { return true; } };

const KLIC = randomBytes(32).toString("base64");
const JINY = randomBytes(32).toString("base64");
const TOKEN = "1//09abcDEF-ghIJKL_mnoPQRs.tuvwxyz0123456789";

const sifra = encryptToken(TOKEN, KLIC);

zkouska("tam a zpět", decryptToken(sifra, KLIC) === TOKEN, "co se zašifruje, se stejným klíčem přečte");
zkouska("neleží čitelně", !sifra.includes(TOKEN) && !sifra.includes("09abcDEF"), "v uloženém řetězci není vidět token");
zkouska("tvar", sifra.startsWith("v1.") && sifra.split(".").length === 4, "verze a tři části");

const druhe = encryptToken(TOKEN, KLIC);
zkouska("pokaždé jinak", druhe !== sifra && decryptToken(druhe, KLIC) === TOKEN, "stejný vstup dá pokaždé jiný zápis (náhodné IV)");

zkouska("jiný klíč", hodi(() => decryptToken(sifra, JINY)), "cizím klíčem to nejde přečíst");

const casti = sifra.split(".");
const prehozeny = [casti[0], casti[1], casti[2].slice(0, -2) + (casti[2].slice(-2) === "AA" ? "BB" : "AA"), casti[3]].join(".");
zkouska("změněná data", hodi(() => decryptToken(prehozeny, KLIC)), "podvržený obsah se pozná, nevrátí nesmysl");
zkouska("změněná značka", hodi(() => decryptToken([casti[0], casti[1], casti[2], casti[3].slice(0, -2) + "AA"].join("."), KLIC)), "poškozená kontrolní značka se pozná");
zkouska("useknuté", hodi(() => decryptToken("v1.abc", KLIC)), "neúplný záznam se odmítne");
zkouska("cizí verze", hodi(() => decryptToken("v9." + casti.slice(1).join("."), KLIC)), "neznámá verze se odmítne");

zkouska("krátký klíč", hodi(() => encryptToken(TOKEN, randomBytes(16).toString("base64"))), "klíč kratší než 32 bajtů se odmítne");
zkouska("nesmyslný klíč", hodi(() => encryptToken(TOKEN, "tohle-neni-base64-klic!!")), "nepoužitelný klíč se odmítne");

zkouska("diakritika", decryptToken(encryptToken("ěščřžýáíé@firma.cz", KLIC), KLIC) === "ěščřžýáíé@firma.cz", "české znaky přežijí");
zkouska("prázdný text", decryptToken(encryptToken("", KLIC), KLIC) === "", "i prázdný řetězec");
const dlouhy = "x".repeat(5000);
zkouska("dlouhý text", decryptToken(encryptToken(dlouhy, KLIC), KLIC) === dlouhy, "dlouhý token");

// Žádná otevřená spojení, proces doběhne sám.
console.log(chyby === 0 ? "\nŠifrování přihlášení ke Gmailu drží." : `\nProblémů: ${chyby}`);
process.exitCode = chyby === 0 ? 0 : 1;
