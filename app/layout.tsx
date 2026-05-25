import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kyveriqx",
  description: "AI tools platform — a marketplace of reconciliation & outreach tools.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* Razorpay Checkout — used by <SubscribeButton>. lazyOnload keeps it
            off the critical path; the modal opens on click, not page load. */}
        <Script
          src="https://checkout.razorpay.com/v1/checkout.js"
          strategy="lazyOnload"
        />
      </body>
    </html>
  );
}
