import "server-only";

import type { GmailPart } from "./mail-body";
import type { RawMessage } from "./mail-rules";
import { mergeThreadIds, type MailLabel } from "./mail-labels";

/**
 * Napojení na Gmail — jen čtení.
 *
 * Appka žádá jediné oprávnění `gmail.readonly` a volá jen čtecí adresy
 * (seznam vláken, jedno vlákno, jedna zpráva, jedna příloha, seznam štítků). Žádné odesílání, mazání ani
 * úpravy tu záměrně nejsou a být nemají: kdyby je někdo doplnil, musel by
 * zároveň rozšířit oprávnění, což je vidět na souhlasné obrazovce Googlu.
 *
 * Přehled pošty čte z vláken jen hlavičky (`format=metadata`), takže Google
 * těla zpráv ani neposílá. Text jedné zprávy se načítá až na výslovné
 * kliknutí (`fetchMessage`) a nikam se neukládá. Totéž platí pro její
 * přílohy (`fetchAttachment`) — a ty navíc jen se zvláštním souhlasem.
 */

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

/**
 * Adresy Googlu. Při vývoji je jde přesměrovat na místní atrapu Gmailu
 * (`GMAIL_TEST_API`, `GMAIL_TEST_TOKEN_URL`), aby šel celý průchod poštou
 * vyzkoušet v prohlížeči bez skutečné schránky.
 *
 * V ostrém provozu se přesměrování ignoruje, ať je v nastavení cokoli:
 * přihlášení ke schránce nesmí odejít nikam jinam než ke Googlu.
 */
const VYVOJ = process.env.NODE_ENV !== "production";
const GMAIL_API = (VYVOJ && process.env.GMAIL_TEST_API) || "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = (VYVOJ && process.env.GMAIL_TEST_TOKEN_URL) || "https://oauth2.googleapis.com/token";

/** Doručená pošta bez reklamních a sociálních záložek. */
const DOTAZ = "in:inbox -category:promotions -category:social";

/** Totéž pro zprávy s vybraným štítkem — ty v doručené být nemusí. */
const DOTAZ_STITEK = "-category:promotions -category:social";

/** Kolik vláken se nejvýš stáhne ze všech zdrojů dohromady — každé je jeden dotaz na Gmail. */
const VLAKEN_CELKEM = 90;

export class GmailError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "GmailError";
  }
}

/** Potřebuje-li appka znovu přihlásit (token odvolaný nebo neplatný). */
export class GmailAuthExpired extends GmailError {
  constructor() {
    super("Připojení ke Gmailu vypršelo nebo bylo odvolané. Připoj schránku znovu.", 401);
    this.name = "GmailAuthExpired";
  }
}

function klientId(): string {
  const v = process.env.GOOGLE_CLIENT_ID;
  if (!v) throw new GmailError("Chybí GOOGLE_CLIENT_ID.");
  return v;
}

function klientSecret(): string {
  const v = process.env.GOOGLE_CLIENT_SECRET;
  if (!v) throw new GmailError("Chybí GOOGLE_CLIENT_SECRET.");
  return v;
}

export function isGmailConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.MAIL_TOKEN_KEY);
}

/**
 * Adresa, kam Google po přihlášení vrátí uživatele. Musí se do znaku shodovat
 * s tím, co je v Google Cloud u klienta — proto se skládá z adresy, na které
 * appka zrovna běží, ne z pevně zapsaného řetězce.
 */
export function redirectUri(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/api/gmail/callback`;
}

export function authUrl(origin: string, state: string): string {
  const p = new URLSearchParams({
    client_id: klientId(),
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: GMAIL_SCOPE,
    // `offline` kvůli refresh tokenu, `consent` aby ho Google poslal i při
    // opakovaném připojení — bez toho ho vrátí jen poprvé a druhé připojení
    // by skončilo bez tokenu.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

type TokenOdpoved = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function tokenPozadavek(body: Record<string, string>): Promise<TokenOdpoved> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });

  const data = (await res.json().catch(() => ({}))) as TokenOdpoved;
  if (!res.ok) {
    // `invalid_grant` = odvolaný nebo vypršelý token; jiné přihlášení nepomůže
    // ničemu než novému připojení schránky.
    if (data.error === "invalid_grant") throw new GmailAuthExpired();
    throw new GmailError(data.error_description ?? data.error ?? `Google odpověděl ${res.status}.`, res.status);
  }
  return data;
}

/** Výměna kódu z přesměrování za trvalé přihlášení. */
export async function exchangeCode(code: string, origin: string): Promise<{ refreshToken: string; accessToken: string }> {
  const data = await tokenPozadavek({
    code,
    client_id: klientId(),
    client_secret: klientSecret(),
    redirect_uri: redirectUri(origin),
    grant_type: "authorization_code",
  });

  if (!data.refresh_token || !data.access_token) {
    throw new GmailError("Google nevrátil přihlašovací token. Zkus připojení znovu.");
  }
  // Pojistka: kdyby se někdy rozšířil rozsah oprávnění, ať se to pozná tady
  // a ne až tím, že appka umí víc, než zásady soukromí slibují.
  if (data.scope && !data.scope.includes(GMAIL_SCOPE)) {
    throw new GmailError("Google nedal oprávnění ke čtení pošty.");
  }
  return { refreshToken: data.refresh_token, accessToken: data.access_token };
}

export async function accessTokenFrom(refreshToken: string): Promise<string> {
  const data = await tokenPozadavek({
    refresh_token: refreshToken,
    client_id: klientId(),
    client_secret: klientSecret(),
    grant_type: "refresh_token",
  });
  if (!data.access_token) throw new GmailAuthExpired();
  return data.access_token;
}

/** Zrušení přístupu u Googlu — volá se při odpojení schránky. */
export async function revokeToken(refreshToken: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
    method: "POST",
  }).catch(() => {
    // Když se to nepovede, uložené přihlášení stejně mažeme — přístup si jde
    // odvolat i ručně v nastavení Google účtu.
  });
}

async function gmailGet<T>(cesta: string, accessToken: string): Promise<T> {
  const res = await fetch(`${GMAIL_API}/${cesta}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 401 || res.status === 403) throw new GmailAuthExpired();
  if (!res.ok) {
    const telo = await res.text().catch(() => "");
    throw new GmailError(`Gmail odpověděl ${res.status}. ${telo.slice(0, 200)}`.trim(), res.status);
  }
  return (await res.json()) as T;
}

export async function fetchEmailAddress(accessToken: string): Promise<string> {
  const profil = await gmailGet<{ emailAddress?: string }>("profile", accessToken);
  if (!profil.emailAddress) throw new GmailError("Gmail nevrátil adresu schránky.");
  return profil.emailAddress.toLowerCase();
}

type Hlavicka = { name?: string; value?: string };
type Zprava = { id?: string; internalDate?: string; payload?: { headers?: Hlavicka[] } };
type Vlakno = { id?: string; messages?: Zprava[] };

function hlavicka(z: Zprava, jmeno: string): string | null {
  const h = z.payload?.headers?.find((x) => (x.name ?? "").toLowerCase() === jmeno.toLowerCase());
  return h?.value ?? null;
}

/**
 * Pošta za posledních `days` dní, po vláknech: z doručené pošty, ze štítků,
 * které si majitel schránky sám vybral, nebo z obojího (`sources`, viz
 * `mailSources` v `mail-labels.ts`). Štítky jsou pro toho, komu Gmail poštu
 * filtrem přesouvá mimo doručenou.
 *
 * Štítek, který mezitím v Gmailu zanikl, načtení neshodí: vrátí se
 * v `missingLabels` a zbytek pošty se načte bez něj.
 *
 * Vlákno se stahuje celé (`threads.get`), protože jen tak je vidět, jestli
 * poslední slovo měli oni, nebo já — moje odpovědi leží v odeslané poště,
 * ne v doručené.
 *
 * V seznamu se ukazuje poslední zpráva **od nich**, ne úplně poslední zpráva
 * vlákna. Jinak by vlákno, ve kterém jsem právě odpověděl, vypadalo jako
 * zpráva ode mě sobě — a protože se vlastní pošta odfiltrovává, zmizelo by
 * z přehledu úplně. Stav („čeká na odpověď“) se přitom počítá z celého
 * vlákna, takže odpovězené vlákno zůstane vidět a je označené jako vyřízené.
 */
export async function fetchInbox(
  accessToken: string,
  days: number,
  myEmail: string,
  sources: { inbox: boolean; labelIds: string[] } = { inbox: true, labelIds: [] },
  maxThreads = 60,
): Promise<{ messages: RawMessage[]; missingLabels: string[] }> {
  const ja = myEmail.trim().toLowerCase();
  const jeOdeMe = (z: Zprava) => (hlavicka(z, "From") ?? "").toLowerCase().includes(ja);

  const stari = `newer_than:${Math.max(1, Math.trunc(days))}d`;
  const seznam = async (cesta: string) => {
    const s = await gmailGet<{ threads?: { id?: string }[] }>(`${cesta}&maxResults=${maxThreads}`, accessToken);
    return (s.threads ?? []).map((t) => t.id).filter((id): id is string => Boolean(id));
  };

  // Doručená pošta se čte, jen když ji majitel schránky mezi zdroji má (`mailSources`).
  const zdroje = sources.inbox ? [await seznam(`threads?q=${encodeURIComponent(`${DOTAZ} ${stari}`)}`)] : [];
  const missingLabels: string[] = [];
  // Pod kterými štítky se vlákno našlo — podle toho se pak pozná, komu patří.
  const stitkyVlakna = new Map<string, string[]>();
  for (const id of sources.labelIds) {
    try {
      const vlakna = await seznam(`threads?labelIds=${encodeURIComponent(id)}&q=${encodeURIComponent(`${DOTAZ_STITEK} ${stari}`)}`);
      for (const v of vlakna) stitkyVlakna.set(v, [...(stitkyVlakna.get(v) ?? []), id]);
      zdroje.push(vlakna);
    } catch (e) {
      // Neznámý štítek Gmail odmítne (400 nebo 404). Vypršelé přihlášení a jiné
      // chyby ale platí pro celou schránku — ty se nepolykají.
      if (e instanceof GmailError && !(e instanceof GmailAuthExpired) && (e.status === 400 || e.status === 404)) {
        missingLabels.push(id);
      } else {
        throw e;
      }
    }
  }

  const idVlaken = mergeThreadIds(zdroje, VLAKEN_CELKEM);
  const out: RawMessage[] = [];

  // Postupně, ne naráz: Gmail má limit na počet dotazů za vteřinu a zápis
  // schránky není nic, na co by se čekalo v reálném čase.
  for (const idVlakna of idVlaken) {
    const vlakno = await gmailGet<Vlakno>(
      `threads/${idVlakna}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      accessToken,
    );

    const zpravy = vlakno.messages ?? [];
    if (zpravy.length === 0) continue;

    // Poslední zpráva od nich; když je celé vlákno jen moje, vezme se
    // poslední a `triage` ho pak odfiltruje.
    const posledni = [...zpravy].reverse().find((z) => !jeOdeMe(z)) ?? zpravy[zpravy.length - 1];
    const kdy = posledni.internalDate ? new Date(Number(posledni.internalDate)) : null;
    if (!posledni.id || !kdy || Number.isNaN(kdy.getTime())) continue;

    out.push({
      gmailId: posledni.id,
      threadId: idVlakna,
      from: hlavicka(posledni, "From"),
      // Předmět bývá jen u první zprávy vlákna, u odpovědí chybí.
      subject: hlavicka(posledni, "Subject") ?? hlavicka(zpravy[0], "Subject"),
      receivedAt: kdy.toISOString(),
      threadSenders: zpravy.map((z) => hlavicka(z, "From") ?? ""),
      labelIds: stitkyVlakna.get(idVlakna) ?? [],
    });
  }

  return { messages: out, missingLabels };
}

/**
 * Odesílatelé jednoho vlákna v pořadí zpráv — jen hlavičky „From“. Slouží
 * tiché kontrole, jestli už poslední slovo ve vlákně není moje. `null`, když
 * vlákno v Gmailu už není.
 */
export async function fetchThreadSenders(accessToken: string, threadId: string): Promise<string[] | null> {
  try {
    const vlakno = await gmailGet<Vlakno>(`threads/${threadId}?format=metadata&metadataHeaders=From`, accessToken);
    return (vlakno.messages ?? []).map((z) => hlavicka(z, "From") ?? "");
  } catch (e) {
    if (e instanceof GmailError && !(e instanceof GmailAuthExpired) && e.status === 404) return null;
    throw e;
  }
}

/**
 * Jedna zpráva celá, včetně textu. Na rozdíl od přehledu pošty tohle Gmail
 * žádá o obsah — volá se proto jen na výslovné kliknutí („Úkol“)
 * a jen když majitel schránky povolil návrh úkolu pomocí AI. Výsledek se
 * nikam neukládá.
 */
export async function fetchMessage(accessToken: string, gmailId: string): Promise<GmailPart | null> {
  const zprava = await gmailGet<{ payload?: GmailPart }>(
    `messages/${encodeURIComponent(gmailId)}?format=full`,
    accessToken,
  );
  return zprava.payload ?? null;
}

/**
 * Obsah jedné přílohy (base64url). Volá se jen na výslovné kliknutí u jedné
 * zprávy a jen když majitel schránky povolil čtení příloh pomocí AI. Nikam
 * se neukládá. Stačí na to stejné oprávnění jako na čtení zprávy.
 */
export async function fetchAttachment(accessToken: string, gmailId: string, attachmentId: string): Promise<string> {
  const priloha = await gmailGet<{ data?: string }>(
    `messages/${encodeURIComponent(gmailId)}/attachments/${encodeURIComponent(attachmentId)}`,
    accessToken,
  );
  return priloha.data ?? "";
}

/**
 * Štítky, které si majitel schránky v Gmailu sám založil — jen jejich jména
 * a identifikátory, žádná pošta. Volá se, když v nastavení vybírá, ze kterých
 * štítků se má pošta načítat navíc k doručené. Systémové štítky (Doručená,
 * Odeslaná, Koš…) se nenabízejí.
 */
export async function fetchLabels(accessToken: string): Promise<MailLabel[]> {
  const odpoved = await gmailGet<{ labels?: { id?: string; name?: string; type?: string }[] }>("labels", accessToken);
  return (odpoved.labels ?? [])
    .filter((l) => l.type === "user" && l.id && l.name)
    .map((l) => ({ id: l.id as string, name: l.name as string }));
}
