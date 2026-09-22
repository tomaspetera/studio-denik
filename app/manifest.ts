import type { MetadataRoute } from "next";

/**
 * Web manifest — díky němu jde appku "Přidat na plochu" a chová se pak
 * jako samostatná appka (vlastní ikona, běží přes celou obrazovku, bez
 * adresního řádku prohlížeče), ne jako záložka.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Studio Deník",
    short_name: "Deník",
    description: "Úkoly, kalendář, klienti a reporty pro grafické studio.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0d0f",
    theme_color: "#0a0d0f",
    icons: [
      { src: "/icon-192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-192", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
