import type { Metadata } from "next";

import { LocaleProvider } from "@/app/locale-provider";
import { getRequestLocale } from "@/lib/request-locale";

import "./globals.css";

const metadataByLocale = {
  en: {
    title: "Text Diff Tool",
    description:
      "Compare two texts side by side in your browser and highlight additions, deletions, and changes.",
  },
  "zh-CN": {
    title: "文本对比工具",
    description: "在浏览器中并排比较两份文本，高亮显示新增、删除和修改的内容。",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    ...metadataByLocale[locale],
    icons: {
      icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
      shortcut: "/favicon.svg",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getRequestLocale();

  return (
    <html lang={locale}>
      <body>
        <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
