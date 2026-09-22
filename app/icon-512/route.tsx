import { ImageResponse } from "next/og";

/** Stejná ikona jako icon-192, jen ve velikosti, kterou chtějí Android/manifest pro "maskable". */
export const dynamic = "force-static";

const SIZE = 512;

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
        <svg width="278" height="278" viewBox="0 0 24 24" fill="none">
          <path d="M4 6h16M4 12h11M4 18h7" stroke="#f0f2ef" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
      </div>
    ),
    { width: SIZE, height: SIZE },
  );
}
