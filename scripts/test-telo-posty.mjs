/**
 * Text zprávy z Gmailu — výběr čitelného textu ze stromu částí, bez sítě,
 * bez databáze a bez AI. Spouští se přímo nad zdrojovým souborem.
 *
 * Hlídá hlavně tři věci: že se nikdy nečte obsah přílohy, že česká pošta
 * ve starém kódování nevyjde rozsypaná a že do AI nejde citovaná starší
 * korespondence, jen to, co odesílatel napsal teď.
 */
import {
  MAIL_BODY_MAX_CHARS,
  cleanText,
  clip,
  decodeBytes,
  extractBody,
  htmlToText,
  isForward,
  prepareBody,
  stripQuoted,
} from "../lib/mail-body.ts";

let chyby = 0;
const ok = (s) => console.log("  " + s);
const zkouska = (nazev, cond, popis) => {
  if (cond) ok(`${nazev.padEnd(28)}ok — ${popis}`);
  else { chyby++; ok(`${nazev.padEnd(28)}ŠPATNĚ — ${popis}`); }
};

// --- Pomůcky na výrobu zpráv ---------------------------------------------------
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const utf8 = (s) => b64url(Buffer.from(s, "utf8"));

// Česká písmena ve dvou starších kódováních. Liší se jen š, ť a ž.
const SPOLECNE = { á: 0xe1, č: 0xe8, ď: 0xef, é: 0xe9, ě: 0xec, í: 0xed, ň: 0xf2, ó: 0xf3, ř: 0xf8, ú: 0xfa, ů: 0xf9, ý: 0xfd };
const CP1250 = { ...SPOLECNE, š: 0x9a, ť: 0x9d, ž: 0x9e };
const LATIN2 = { ...SPOLECNE, š: 0xb9, ť: 0xbb, ž: 0xbe };
const vKodovani = (s, tabulka) => Uint8Array.from([...s].map((ch) => tabulka[ch] ?? ch.charCodeAt(0)));

const cast = (mimeType, data, extra = {}) => ({
  mimeType,
  filename: "",
  headers: [{ name: "Content-Type", value: `${mimeType}; charset="UTF-8"` }],
  body: { data, size: data.length },
  ...extra,
});
const priloha = (filename, mimeType = "application/pdf", extra = {}) => ({
  mimeType,
  filename,
  headers: [{ name: "Content-Disposition", value: `attachment; filename="${filename}"` }],
  body: { attachmentId: "att-1", size: 12345 },
  ...extra,
});

// --- Výběr části -----------------------------------------------------------------
let r = extractBody(cast("text/plain", utf8("Dobrý den,\nposílám podklady.")));
zkouska("prostý text", r.text === "Dobrý den,\nposílám podklady." && r.attachments === 0, "zpráva bez částí");

r = extractBody({
  mimeType: "multipart/alternative",
  parts: [cast("text/plain", utf8("textová verze")), cast("text/html", utf8("<p>HTML verze</p>"))],
});
zkouska("text má přednost", r.text === "textová verze", "když je text i HTML, bere se text");

r = extractBody({
  mimeType: "multipart/alternative",
  parts: [cast("text/plain", utf8("   \n ")), cast("text/html", utf8("<p>Jen v HTML</p>"))],
});
zkouska("prázdný text", r.text.trim() === "Jen v HTML", "prázdná textová část se přeskočí");

r = extractBody({
  mimeType: "multipart/mixed",
  parts: [
    { mimeType: "multipart/alternative", parts: [cast("text/plain", utf8("vnořený text")), cast("text/html", utf8("<b>x</b>"))] },
    priloha("nabidka.pdf"),
    priloha("logo.ai", "application/postscript"),
  ],
});
zkouska("vnořené části", r.text === "vnořený text" && r.attachments === 2, "text z vnořené části, dvě přílohy");

r = extractBody({
  mimeType: "multipart/related",
  parts: [
    cast("text/html", utf8("<p>Podpis s logem</p>")),
    priloha("image001.png", "image/png", {
      headers: [{ name: "Content-Disposition", value: "inline; filename=image001.png" }, { name: "Content-ID", value: "<image001>" }],
    }),
  ],
});
zkouska("logo v podpisu", r.attachments === 0, "vložený obrázek se nepočítá jako příloha");

// Nejdůležitější: textový soubor v příloze se nesmí vydávat za text zprávy.
const tajne = cast("text/plain", utf8("TAJNÝ OBSAH PŘÍLOHY"), {
  filename: "poznamky.txt",
  headers: [{ name: "Content-Disposition", value: 'attachment; filename="poznamky.txt"' }],
});
r = extractBody({ mimeType: "multipart/mixed", parts: [tajne, cast("text/html", utf8("<p>Skutečný text</p>"))] });
zkouska("textová příloha", !r.text.includes("TAJNÝ") && r.text.trim() === "Skutečný text" && r.attachments === 1, "obsah přílohy se nečte, ani když je to text");

r = extractBody({ mimeType: "multipart/mixed", parts: [tajne] });
zkouska("jen příloha", r.text === "" && r.attachments === 1, "zpráva bez textu zůstane prázdná");

zkouska("žádná zpráva", extractBody(null).text === "" && extractBody(undefined).attachments === 0, "chybějící data nespadnou");
zkouska("rozbitý base64", extractBody(cast("text/plain", "@@@ tohle není base64 @@@")).text === "", "poškozený obsah = prázdný text");
zkouska("base64 s - a _", extractBody(cast("text/plain", "Pz8_Pj4-")).text === "???>>>", "varianta base64 pro adresy");

// --- Kódování ---------------------------------------------------------------------
const veta = "Příliš žluťoučký kůň";
const sKodovanim = (bytes, charset) => ({
  mimeType: "text/plain",
  filename: "",
  headers: charset ? [{ name: "Content-Type", value: `text/plain; charset=${charset}` }] : [],
  body: { data: b64url(bytes) },
});
zkouska("windows-1250", extractBody(sKodovanim(vKodovani(veta, CP1250), "windows-1250")).text === veta, "starší Outlook");
zkouska("iso-8859-2", extractBody(sKodovanim(vKodovani(veta, LATIN2), '"ISO-8859-2"')).text === veta, "starší Seznam a linuxové programy");
zkouska("kódování neuvedeno", extractBody(sKodovanim(vKodovani(veta, CP1250), null)).text === veta, "bez hlavičky se zkusí windows-1250");
zkouska("UTF-8 přes hlavičku", extractBody(sKodovanim(Buffer.from(veta, "utf8"), "iso-8859-2")).text === veta, "platné UTF-8 vyhraje nad špatnou hlavičkou");
zkouska("neznámé kódování", decodeBytes(vKodovani(veta, CP1250), "x-nesmysl-9") === veta, "neznámý název nespadne, zkusí se další");
zkouska("čisté ASCII", decodeBytes(Buffer.from("Hello"), "iso-8859-2") === "Hello", "bez diakritiky je to jedno");

// --- HTML na text -------------------------------------------------------------------
let t = htmlToText("<html><head><style>p{color:red}</style><title>Titulek</title></head><body><p>První</p><p>Druhý<br>řádek</p></body></html>");
zkouska("HTML: odstavce", cleanText(t) === "První\nDruhý\nřádek", "styly a titulek pryč, odstavce na řádky");

t = htmlToText("<p>Cena 1&nbsp;200&nbsp;K&#269; &amp; DPH, &bdquo;uvozovky&ldquo; &scaron;&Scaron; &#x159;</p>");
zkouska("HTML: entity", cleanText(t) === "Cena 1 200 Kč & DPH, „uvozovky“ šŠ ř", "pojmenované, desítkové i šestnáctkové");

t = htmlToText("<ul><li>vizitky</li><li>letáky</li></ul><script>alert(1)</script><!-- skrytá poznámka -->");
zkouska("HTML: seznam", cleanText(t) === "• vizitky\n• letáky", "odrážky zůstanou, skript a komentář zmizí");

t = htmlToText('<div>Souhlasím, pošlete to do tisku.</div><div class="gmail_quote"><div>Dne … napsal:</div><blockquote>starý text</blockquote></div>');
zkouska("HTML: citace Gmailu", cleanText(t) === "Souhlasím, pošlete to do tisku.", "citovaná zpráva se odřízne");

t = htmlToText("<p>Nahoře</p><blockquote>vnější<blockquote>vnitřní</blockquote>zbytek</blockquote><p>Dole</p>");
zkouska("HTML: vnořené citace", cleanText(t) === "Nahoře\n\nDole" || cleanText(t) === "Nahoře\nDole", "vnořené <blockquote> zmizí celé");

t = htmlToText('<div>Posílám dál.</div><div class="gmail_quote"><div>---------- Forwarded message ---------</div><blockquote>původní požadavek klienta</blockquote></div>', true);
zkouska("HTML: přeposlané", t.includes("původní požadavek klienta"), "u přeposlané zprávy se citace nechá");

const obri = "<p>" + "slovo ".repeat(80_000) + "</p>";
const zacatek = Date.now();
t = htmlToText(obri);
zkouska("HTML: obří zpráva", t.length <= 200_000 && Date.now() - zacatek < 2000, "strop na délku, zpracování nezdrží");

// --- Úklid ---------------------------------------------------------------------------
zkouska("úklid", cleanText("a\r\nb c​\n\n\n\n\nd  \t e   ") === "a\nb c\n\nd e", "konce řádků, pevné mezery, neviditelné znaky, prázdné řádky");

// --- Citovaná korespondence --------------------------------------------------------
const odpoved = "Dobrý den,\nsouhlasím s náhledem, pošlete to prosím do tisku do pátku.\n\nJana";
const cituj = (hlavicka) => `${odpoved}\n\n${hlavicka}\n> Dobrý den, posílám náhled.\n> Tomáš`;

zkouska("citace: Gmail česky", stripQuoted(cituj("po 28. 9. 2026 v 10:15 odesílatel Tomáš Petera <tomas@studio.cz> napsal:")) === odpoved, "„… odesílatel … napsal:“");
zkouska("citace: Dne … napsal(a)", stripQuoted(cituj("Dne 28.09.2026 v 10:15 Tomáš Petera napsal(a):")) === odpoved, "starší český tvar");
zkouska("citace: Gmail anglicky", stripQuoted(cituj("On Mon, Sep 28, 2026 at 10:15 AM Tomáš Petera <tomas@studio.cz> wrote:")) === odpoved, "„On … wrote:“");
zkouska("citace: na dva řádky", stripQuoted(cituj("On Mon, Sep 28, 2026 at 10:15 AM Tomáš Petera <tomas@studio.cz>\nwrote:")) === odpoved, "zalomená hlavička citace");
zkouska("citace: Original Message", stripQuoted(`${odpoved}\n\n-----Original Message-----\nFrom: Tomáš\nstarý text`) === odpoved, "Outlook anglicky");
zkouska("citace: Původní e-mail", stripQuoted(`${odpoved}\n\n---------- Původní e-mail ----------\nOd: Tomáš\nstarý text`) === odpoved, "Seznam");
zkouska("citace: blok Od/Odesláno", stripQuoted(`${odpoved}\n\nOd: Tomáš Petera <tomas@studio.cz>\nOdesláno: pondělí 28. září 2026 10:15\nKomu: Jana\nPředmět: Náhled\n\nstarý text`) === odpoved, "Outlook česky bez oddělovače");
zkouska("citace: From/Sent", stripQuoted(`${odpoved}\n\nFrom: Tomas <tomas@studio.cz>\nSent: Monday, September 28, 2026 10:15 AM\nTo: Jana\n\nold text`) === odpoved, "Outlook anglicky bez oddělovače");
zkouska("citace: čára", stripQuoted(`${odpoved}\n\n________________________________\nOd: Tomáš\nstarý text`) === odpoved, "dlouhá čára Outlooku");
zkouska("citace: jen >", stripQuoted(`${odpoved}\n> stará věta\n> druhá`) === odpoved, "řádky s „>“ bez hlavičky");
zkouska("podpis", stripQuoted(`${odpoved}\n-- \nJana Nováková\ntel. 777 000 000`.replace("-- \n", "--\n")) === odpoved, "podpis za „--“ se odřízne");

const veta2 = "Jak mi včera Petr napsal:\nchce to celé modře.\nUdělejme to tak.";
zkouska("běžná věta", stripQuoted(veta2) === veta2, "věta končící „napsal:“ bez data není hlavička citace");

const odLine = "Od: pondělí platí nový ceník.\nPošlu ho zítra.";
zkouska("„Od:“ ve větě", stripQuoted(odLine) === odLine, "řádek začínající „Od:“ bez bloku hlaviček se neřeže");

const mezi = "Dne 28.09.2026 v 10:15 Tomáš Petera napsal(a):\n> Chcete matné, nebo lesklé lamino?\nMatné.\n> A kolik kusů?\n500 kusů, prosím do pátku.";
zkouska("odpověď mezi řádky", stripQuoted(mezi) === "Matné.\n500 kusů, prosím do pátku.", "zůstanou jen nové řádky");

const jenCitace = "Dne 28.09.2026 v 10:15 Tomáš Petera napsal(a):\n> jen stará zpráva";
zkouska("samá citace", stripQuoted(jenCitace) === jenCitace, "když nic nového není, vrátí se celý text");

const preposlano = "Ahoj, prosím vyřiď.\n\n---------- Forwarded message ---------\nOd: Klient <klient@firma.cz>\nDate: Mon, 28 Sep 2026\n\nPotřebujeme 200 vizitek do středy.";
zkouska("přeposlané: text", stripQuoted(preposlano, true) === preposlano, "u přeposlané zprávy se neřeže nic");

// --- Přeposlaná zpráva podle předmětu ---------------------------------------------
zkouska("předmět Fwd", isForward("Fwd: Vizitky") && isForward("FW: Vizitky") && isForward(" fw: x") && isForward("Přeposláno: x"), "běžné tvary");
zkouska("předmět Re", !isForward("Re: Vizitky") && !isForward("Vizitky") && !isForward(null) && !isForward("Fwdx"), "odpověď ani obyčejný předmět přeposlání není");

// --- Uříznutí ----------------------------------------------------------------------------
let c = clip("krátký text", 100);
zkouska("uříznutí: krátký", c.text === "krátký text" && c.truncated === false, "pod limitem beze změny");
c = clip("jedna dvě tři čtyři pět šest sedm osm devět deset", 30);
zkouska("uříznutí: na slově", c.truncated && c.text.length <= 30 && !/\s$/.test(c.text) && "jedna dvě tři čtyři pět šest sedm osm devět deset".startsWith(c.text) && /(dvě|tři|čtyři|pět|šest)$/.test(c.text), "řez na hranici slova");
c = clip("a".repeat(29) + "😀" + "b".repeat(20), 30);
zkouska("uříznutí: emoji", c.truncated && !/[\uD800-\uDBFF]$/.test(c.text), "nezůstane půlka znaku");
c = clip("x".repeat(500), 100);
zkouska("uříznutí: bez mezer", c.text.length === 100 && c.truncated, "text bez mezer se uřízne natvrdo");

// --- Celá cesta ----------------------------------------------------------------------------
let p = prepareBody(
  {
    mimeType: "multipart/mixed",
    parts: [
      {
        mimeType: "multipart/alternative",
        parts: [
          cast("text/plain", utf8(`${odpoved}\r\n\r\npo 28. 9. 2026 v 10:15 odesílatel Tomáš Petera <tomas@studio.cz> napsal:\r\n> Dobrý den, posílám náhled.`)),
          cast("text/html", utf8("<p>html</p>")),
        ],
      },
      priloha("podklady.zip", "application/zip"),
    ],
  },
  "Re: Leták A5",
);
zkouska("celá cesta: odpověď", p.text === odpoved && p.attachments === 1 && p.truncated === false, "čistý text bez citace, jedna příloha");

p = prepareBody(cast("text/plain", utf8(preposlano)), "Fwd: Vizitky pro klienta");
zkouska("celá cesta: Fwd", p.text.includes("200 vizitek do středy"), "přeposlaný požadavek zůstane");

p = prepareBody(cast("text/plain", utf8(preposlano)), "Vizitky pro klienta");
zkouska("celá cesta: Fwd v těle", p.text.includes("200 vizitek do středy"), "pozná se i podle značky v textu, když předmět někdo přepsal");

p = prepareBody(cast("text/plain", utf8("Dlouhý e-mail. ".repeat(1000))), "Dlouhý");
zkouska("celá cesta: dlouhý", p.truncated && p.text.length <= MAIL_BODY_MAX_CHARS, `uříznuto na ${MAIL_BODY_MAX_CHARS} znaků`);

p = prepareBody({ mimeType: "multipart/mixed", parts: [priloha("faktura.pdf")] }, "Faktura");
zkouska("celá cesta: bez textu", p.text === "" && p.attachments === 1, "zpráva jen s přílohou nemá co číst");

p = prepareBody(null, null);
zkouska("celá cesta: nic", p.text === "" && p.attachments === 0 && p.truncated === false, "prázdný vstup");

// Žádná otevřená spojení, proces doběhne sám. `process.exit()` hned po zápisu
// do roury na Windows občas spadne v knihovně libuv a vrátí chybný kód.
console.log(chyby === 0 ? "\nČtení textu zprávy drží." : `\nProblémů: ${chyby}`);
process.exitCode = chyby === 0 ? 0 : 1;
