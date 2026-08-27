import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Text Diff Tool",
  description:
    "Compare two texts side by side in your browser and highlight additions, deletions, and changes.",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
