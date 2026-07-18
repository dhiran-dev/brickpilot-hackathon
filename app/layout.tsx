import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BrickPilot — See your home before you build it",
  description:
    "Turn the home you have been imagining into a clear, considered concept—and move forward with confidence.",
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
