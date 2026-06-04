import "./globals.css";
import type { ReactNode } from "react";
import { Playfair_Display, Source_Sans_3 } from "next/font/google";
import { Leaf } from "lucide-react";
import { PaperGrain } from "@/components/PaperGrain";

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["600", "700"],
  style: ["normal", "italic"],
  variable: "--font-playfair",
  display: "swap",
});
const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-source-sans",
  display: "swap",
});

export const metadata = {
  title: "Harness Manager",
  description: "A quiet garden for your repositories.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${playfair.variable} ${sourceSans.variable}`}>
      <body>
        <PaperGrain />
        <div className="mx-auto max-w-7xl px-6 py-12 md:px-10 md:py-20">
          <header className="mb-16 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-clay-soft">
              <Leaf strokeWidth={1.5} className="h-5 w-5 text-sage" />
            </span>
            <div>
              <h1 className="m-0 text-2xl">
                Harness <span className="font-normal italic text-sage">Manager</span>
              </h1>
              <p className="m-0 text-sm text-forest/60">A quiet garden for your repositories.</p>
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
