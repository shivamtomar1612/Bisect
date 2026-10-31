import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BISECT — Optimistic computation verification",
  description: "An early-stage protocol for challenging committed computation traces.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
