import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Studio Deník",
  description: "Týdenní reporty, hlídání termínů a stav zakázek pro grafické studio.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f0f2ef" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0d0f" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs" suppressHydrationWarning>
      <head>
        {/*
          Motiv se musí nastavit dřív, než se vykreslí první pixel, jinak
          tmavý režim problikne bíle. Proto inline skript v hlavičce.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
