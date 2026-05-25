import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kyveriqx",
  description: "AI tools platform — a marketplace of reconciliation & outreach tools.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
