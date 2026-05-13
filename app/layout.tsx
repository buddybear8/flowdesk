import type { Metadata } from "next";
import { WhopApp } from "@whop/react/components";
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
      <body>
        <WhopApp>{children}</WhopApp>
      </body>
    </html>
  );
}
