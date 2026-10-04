/**
 * Vymyšlené přílohy pro zkoušky čtení příloh — PDF s textem a obrázek PNG.
 * Skládají se tady ručně, bez knihoven, aby zkouška nepotřebovala nic
 * instalovat a v repozitáři neležely žádné binární soubory.
 */
import { crc32, deflateSync } from "node:zlib";

// Písmo Helvetica v PDF zná jen západoevropskou sadu. Z češtiny v ní jsou
// čárky a š/ž; zbylé háčky se převedou na písmeno bez háčku. Na čtení to
// nevadí — a zkouška tím nepotřebuje vkládat vlastní písmo.
const BEZ_HACKU = { č: "c", ď: "d", ě: "e", ň: "n", ř: "r", ť: "t", ů: "u", Č: "C", Ď: "D", Ě: "E", Ň: "N", Ř: "R", Ť: "T", Ů: "U" };
const WIN_ANSI = { š: 0x9a, ž: 0x9e, Š: 0x8a, Ž: 0x8e, "–": 0x96, "—": 0x97, "„": 0x84, "“": 0x93, "”": 0x94, "•": 0x95, "…": 0x85 };

function pdfText(s) {
  const bytes = [];
  for (const ch of s) {
    const c = BEZ_HACKU[ch] ?? ch;
    const code = WIN_ANSI[c] ?? c.charCodeAt(0);
    if (code > 0xff) throw new Error(`Znak „${ch}“ zkušební PDF neumí.`);
    // Závorky a zpětné lomítko mají v PDF řetězci zvláštní význam.
    if (code === 0x28 || code === 0x29 || code === 0x5c) bytes.push(0x5c);
    bytes.push(code);
  }
  return Buffer.from(bytes);
}

/**
 * PDF s textem. `pages` je seznam stran, každá strana seznam řádků.
 * Nekomprimované a co nejjednodušší — jde o obsah, ne o vzhled.
 */
export function makePdf(pages) {
  const objects = [];
  const add = (body) => { objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1")); return objects.length; };

  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(""); // strom stran — doplní se, až budou známá čísla stran
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");

  const kids = [];
  for (const lines of pages) {
    const text = Buffer.concat([
      Buffer.from("BT /F1 12 Tf 56 780 Td 18 TL\n", "latin1"),
      ...lines.flatMap((l) => [Buffer.from("(", "latin1"), pdfText(l), Buffer.from(") Tj T*\n", "latin1")]),
      Buffer.from("ET", "latin1"),
    ]);
    const stream = add(Buffer.concat([Buffer.from(`<< /Length ${text.length} >>\nstream\n`, "latin1"), text, Buffer.from("\nendstream", "latin1")]));
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${stream} 0 R >>`));
  }
  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`, "latin1");

  const parts = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets = [];
  let at = parts[0].length;
  objects.forEach((body, i) => {
    const obj = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1")]);
    offsets.push(at);
    at += obj.length;
    parts.push(obj);
  });

  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`;
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body) >>> 0, body.length + 4);
  return out;
}

/** Obrázek PNG — barevné pruhy. Na obsahu nezáleží, jde o typ a velikost. */
export function makePng(width = 640, height = 400) {
  const barvy = [[214, 62, 44], [245, 196, 66], [48, 130, 96], [44, 88, 170]];
  const row = Buffer.alloc(1 + width * 3);
  const raw = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y++) {
    const [r, g, b] = barvy[Math.floor((y / height) * barvy.length)];
    for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
    row.copy(raw, y * row.length);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8 bitů na kanál, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
