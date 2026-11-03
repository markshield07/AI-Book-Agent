import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Editorial Studio",
  description: "Professional AI-assisted manuscript editing and publishing preparation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
