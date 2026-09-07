import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scree",
  description: "A survey map of how you get liquidated.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
