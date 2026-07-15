import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BrickPilot — AI house design",
  description:
    "Type a sentence, get a dimensionally-accurate floor plan, a validation and cost report, and photoreal renders.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
