import type { Metadata } from "next";
import { Cinzel, EB_Garamond, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

/**
 * Three faces, one rule. Names and titles are cut in Roman capitals, prose is
 * set in an old-style book face, and every measured number is monospaced — so a
 * reader can tell at a glance which marks on the chart are data.
 */
const cinzel = Cinzel({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-display" });
const garamond = EB_Garamond({ subsets: ["latin"], variable: "--font-body" });
const plex = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Scree — Liquidation Topography",
  description: "A living survey of how you get liquidated. Sculpt your defence.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${cinzel.variable} ${garamond.variable} ${plex.variable}`}>
      <body>{children}</body>
    </html>
  );
}
