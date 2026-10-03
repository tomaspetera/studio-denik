import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Šifrování přihlášení ke Gmailu (`refresh_token`), aby v databázi neleželo
 * čitelně. Kdo by se k tabulce dostal bez klíče `MAIL_TOKEN_KEY`, nepřečte nic.
 *
 * AES-256-GCM: kromě utajení hlídá i neporušenost — po změně jediného znaku
 * rozšifrování selže, místo aby vrátilo nesmysl. Klíč se předává jako
 * parametr (ne čte z prostředí), aby šly funkce otestovat samy o sobě.
 *
 * Tvar uloženého řetězce: `v1.<iv>.<šifra>.<značka>`, všechno base64url.
 */

const VERZE = "v1";
const IV_DELKA = 12; // doporučená délka pro GCM

function klicZBase64(keyBase64: string): Buffer {
  let klic: Buffer;
  try {
    klic = Buffer.from(keyBase64, "base64");
  } catch {
    throw new Error("MAIL_TOKEN_KEY není platný base64.");
  }
  if (klic.length !== 32) {
    throw new Error("MAIL_TOKEN_KEY musí mít 32 bajtů (base64 z 32 náhodných bajtů).");
  }
  return klic;
}

export function encryptToken(plain: string, keyBase64: string): string {
  const klic = klicZBase64(keyBase64);
  const iv = randomBytes(IV_DELKA);
  const sifra = createCipheriv("aes-256-gcm", klic, iv);
  const data = Buffer.concat([sifra.update(plain, "utf8"), sifra.final()]);
  const znacka = sifra.getAuthTag();
  return [VERZE, iv.toString("base64url"), data.toString("base64url"), znacka.toString("base64url")].join(".");
}

export function decryptToken(blob: string, keyBase64: string): string {
  const klic = klicZBase64(keyBase64);
  const casti = blob.split(".");
  if (casti.length !== 4 || casti[0] !== VERZE) {
    throw new Error("Uložené přihlášení ke Gmailu má neznámý tvar.");
  }

  const iv = Buffer.from(casti[1], "base64url");
  const data = Buffer.from(casti[2], "base64url");
  const znacka = Buffer.from(casti[3], "base64url");
  if (iv.length !== IV_DELKA) throw new Error("Uložené přihlášení ke Gmailu je poškozené.");

  const desifra = createDecipheriv("aes-256-gcm", klic, iv);
  desifra.setAuthTag(znacka);
  // `final()` vyhodí výjimku, když značka nesedí — tedy když data někdo
  // změnil, nebo je klíč jiný než ten, kterým se šifrovalo.
  return Buffer.concat([desifra.update(data), desifra.final()]).toString("utf8");
}
