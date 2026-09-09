import type { Metadata, Viewport } from "next";
import { Cinzel, EB_Garamond, IBM_Plex_Mono, Press_Start_2P } from "next/font/google";
import "./globals.css";

/**
 * Four faces, one rule. Names and titles are cut in Roman capitals, prose is
 * set in an old-style book face, and every measured number is monospaced — so a
 * reader can tell at a glance which marks on the chart are data.
 */
const cinzel = Cinzel({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-display" });
const garamond = EB_Garamond({ subsets: ["latin"], variable: "--font-body" });
const plex = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });
// The fourth face is the game's: a pixel grotesque for the title bar and the instrument headings.
const pixel = Press_Start_2P({ subsets: ["latin"], weight: "400", variable: "--font-pixel" });

export const metadata: Metadata = {
  title: "Scree — Liquidation Topography",
  description: "A living survey of how you get liquidated. Sculpt your defence.",
};

/** A phone shows the survey edge to edge, at its own density, and does not scale the page. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#141c22",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${cinzel.variable} ${garamond.variable} ${plex.variable} ${pixel.variable}`}>
      <body>{children}</body>
    </html>
  );
}
