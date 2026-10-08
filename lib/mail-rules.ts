/**
 * Třídění pošty — čistá pravidla bez Gmailu, bez databáze a bez AI.
 *
 * Třídění se obejde bez umělé inteligence: všechno, co appka o zprávě
 * „ví“, vzniká tady z hlaviček. AI přijde ke slovu jen u návrhu úkolu
 * z jedné zprávy, na výslovné kliknutí a se souhlasem majitele schránky
 * (viz `mail-data.ts`, migrace 0019 a stránka se zásadami soukromí).
 *
 * Dvě otázky, na které pravidla odpovídají:
 *  1) Čeká zpráva na mou odpověď? → poslední zpráva ve vlákně je od nich.
 *  2) Komu patří? → štítek, kterému majitel schránky přiřadil klienta;
 *     jinak adresa odesílatele proti kontaktům klientů.
 */

export type MailStatus = "waiting" | "info";

export type Sender = { name: string | null; email: string };

/**
 * Hlavička „From“ chodí v několika tvarech:
 *   Jana Nováková <jana@firma.cz>
 *   "Nováková, Jana" <jana@firma.cz>
 *   jana@firma.cz
 * Vrací `null`, když v ní žádná adresa není.
 */
export function parseFrom(header: string | null | undefined): Sender | null {
  const raw = (header ?? "").trim();
  if (!raw) return null;

  const uvnitr = raw.match(/<([^>]+)>/);
  const email = (uvnitr ? uvnitr[1] : raw).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;

  let name: string | null = null;
  if (uvnitr) {
    name = raw.slice(0, raw.indexOf("<")).trim().replace(/^"|"$/g, "").trim() || null;
  }
  return { name, email };
}

export function domainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

/**
 * Veřejné poštovní služby. Podle domény se u nich klient hádat nesmí —
 * kdyby měl klient kontakt na gmail.com, přiřadil by se mu každý, kdo píše
 * z Gmailu. U takových adres platí jen přesná shoda.
 */
const VEREJNE_DOMENY = new Set([
  "gmail.com", "googlemail.com", "seznam.cz", "email.cz", "centrum.cz", "post.cz",
  "atlas.cz", "volny.cz", "tiscali.cz", "azet.sk", "zoznam.sk", "outlook.com",
  "outlook.cz", "hotmail.com", "hotmail.cz", "live.com", "msn.com", "yahoo.com",
  "yahoo.co.uk", "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com",
  "pm.me", "gmx.com", "gmx.net", "gmx.de", "web.de", "aol.com", "zoho.com",
]);

export function isPublicDomain(domain: string): boolean {
  return VEREJNE_DOMENY.has(domain.toLowerCase());
}

export type ClientContact = {
  clientId: string;
  /** Adresy, které k danému klientovi patří (z karty klienta i z kontaktů). */
  emails: string[];
};

/**
 * Komu zpráva patří. Nejdřív přesná adresa, teprve pak doména — a doménu jen
 * u firemní, ne u veřejné poštovní služby. Když doména sedí víc klientům,
 * nehádá se a vrací `null`.
 */
export function matchClient(email: string, contacts: ClientContact[]): string | null {
  const adresa = email.trim().toLowerCase();
  if (!adresa) return null;

  const presne = contacts.filter((c) => c.emails.some((e) => e.trim().toLowerCase() === adresa));
  if (presne.length === 1) return presne[0].clientId;
  if (presne.length > 1) return null;

  const domena = domainOf(adresa);
  if (!domena || isPublicDomain(domena)) return null;

  const podleDomeny = contacts.filter((c) =>
    c.emails.some((e) => {
      const kandidat = e.trim().toLowerCase();
      return kandidat.includes("@") && domainOf(kandidat) === domena && !isPublicDomain(domainOf(kandidat));
    }),
  );
  return podleDomeny.length === 1 ? podleDomeny[0].clientId : null;
}

/** Sedí adresa na vzorec z „ignorovaných“? Vzorec je celá adresa, nebo doména. */
export function matchesIgnored(email: string, patterns: string[]): boolean {
  const adresa = email.trim().toLowerCase();
  const domena = domainOf(adresa);
  return patterns.some((p) => {
    const vzorec = p.trim().toLowerCase().replace(/^@/, "");
    if (!vzorec) return false;
    return vzorec.includes("@") ? vzorec === adresa : vzorec === domena;
  });
}

export type ThreadInfo = {
  /** Vlastní adresa — podle ní se pozná, co jsem poslal já. */
  myEmail: string;
  /**
   * Odesílatelé ve vlákně, v pořadí, jak zprávy přišly — holé adresy, nebo celé
   * hlavičky „From“ tak, jak je vrací Gmail (`Jméno <adresa>`).
   */
  sendersInOrder: string[];
};

/**
 * Čeká vlákno na mou odpověď? Rozhoduje poslední zpráva: pokud ji poslal
 * někdo jiný, míč je u mě. Když jsem poslední psal já, čeká se na ně.
 *
 * Záměrně se nekouká na to, kolik zpráv ve vlákně je — jen na poslední.
 *
 * Odesílatel se z hlavičky nejdřív vyloupne: Gmail vrací `Jméno <adresa>`
 * a prosté porovnání s vlastní adresou by nesedělo nikdy — odpovězené vlákno
 * by pak čekalo na odpověď napořád.
 */
export function threadStatus(thread: ThreadInfo): MailStatus {
  const ja = thread.myEmail.trim().toLowerCase();
  const posledni = [...thread.sendersInOrder].reverse().find((s) => s.trim());
  if (!posledni) return "info";
  const adresa = parseFrom(posledni)?.email ?? posledni.trim().toLowerCase();
  return adresa === ja ? "info" : "waiting";
}

export type RawMessage = {
  gmailId: string;
  threadId: string;
  from: string | null;
  subject: string | null;
  /** ISO datum přijetí. */
  receivedAt: string;
  /** Odesílatelé celého vlákna v pořadí — z Gmailu se dotahují zvlášť. */
  threadSenders: string[];
  /** Štítky Gmailu, pod kterými se vlákno našlo (jen ty, které si majitel schránky vybral). */
  labelIds?: string[];
};

export type TriagedMessage = {
  gmailId: string;
  threadId: string;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  receivedAt: string;
  status: MailStatus;
  clientId: string | null;
};

export type TriageContext = {
  myEmail: string;
  contacts: ClientContact[];
  ignored: string[];
  /**
   * Klient podle štítku, pod kterým zpráva v Gmailu leží (`labelClient`
   * v `mail-labels.ts`). Má přednost před adresou odesílatele: štítek je
   * výslovné pravidlo majitele schránky, adresa jen odhad — tentýž člověk
   * může psát kvůli dvěma značkám.
   */
  labelClient?: (labelIds: string[]) => string | null;
};

/**
 * Z hlaviček roztříděné zprávy. Co nemá rozpoznatelného odesílatele nebo
 * sedí na ignorovaný vzorec, se zahodí — do databáze se takové zprávy
 * vůbec nedostanou.
 */
export function triage(messages: RawMessage[], ctx: TriageContext): TriagedMessage[] {
  const out: TriagedMessage[] = [];
  const videno = new Set<string>();

  for (const m of messages) {
    const sender = parseFrom(m.from);
    if (!sender) continue;
    if (matchesIgnored(sender.email, ctx.ignored)) continue;
    // Vlastní odeslaná pošta v doručených nemá co dělat.
    if (sender.email === ctx.myEmail.trim().toLowerCase()) continue;
    if (videno.has(m.gmailId)) continue;
    videno.add(m.gmailId);

    out.push({
      gmailId: m.gmailId,
      threadId: m.threadId,
      fromEmail: sender.email,
      fromName: sender.name,
      subject: (m.subject ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || null,
      receivedAt: m.receivedAt,
      status: threadStatus({ myEmail: ctx.myEmail, sendersInOrder: m.threadSenders }),
      clientId: ctx.labelClient?.(m.labelIds ?? []) ?? matchClient(sender.email, ctx.contacts),
    });
  }

  return out.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0));
}
