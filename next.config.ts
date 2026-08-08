import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vývojářský indikátor sedí ve výchozím stavu vlevo dole, kde překrývá
  // odhlašovací tlačítko v liště. Ve vývoji ho tedy posouváme doprava.
  devIndicators: {
    position: "bottom-right",
  },
};

export default nextConfig;
