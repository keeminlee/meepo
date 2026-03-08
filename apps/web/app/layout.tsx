import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { PersistentAmbient } from "@/components/layout/persistent-ambient";
import "@/app/globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Meepo Archive",
  description: "The celestial chronicle of your campaign sessions.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${playfairDisplay.variable}`}>
        <Providers>
          <PersistentAmbient />
          <div className="app-foreground-root">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
