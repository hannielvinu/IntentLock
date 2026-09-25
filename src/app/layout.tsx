import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IntentLock | Payment recovery",
  description: "A safe payment recovery operations console and checkout simulator.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
