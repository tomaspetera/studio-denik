import { ImageResponse } from "next/og";

/**
 * Ikona appky pro instalaci na plochu telefonu. Generovaná kódem — stejná
 * značka jako v levém panelu appky (sešitové linky), ne nový obrázek, který
 * by se musel udržovat zvlášť.
 *
 * Kreslí se přes celý čtverec beze zaoblení: telefon/OS si roh sám ořízne
 * podle svého stylu (kolo, "squircle"…), appka jen musí nechat dost místa
 * kolem znaku, ať se do toho ořezu vejde — proto širší okraj než uprostřed
 * samotné SVG linky.
 */
export const dynamic = "force-static";

const SIZE = 192;

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#12171a",
        }}
      >
        <svg width="104" height="104" viewBox="0 0 24 24" fill="none">
          <path d="M4 6h16M4 12h11M4 18h7" stroke="#f0f2ef" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
      </div>
    ),
    { width: SIZE, height: SIZE },
  );
}
