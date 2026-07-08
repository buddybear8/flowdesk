import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Champagne Sessions",
  description: "Trading intelligence dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/* max-md:overflow-x-hidden — mobile-only guard against body-level
          horizontal scroll; desktop (md+) body is untouched. */}
      <body className="max-md:overflow-x-hidden">{children}</body>
    </html>
  );
}
