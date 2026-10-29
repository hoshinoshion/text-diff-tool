import type { Metadata, Viewport } from "next";

import { LocaleProvider } from "@/app/locale-provider";
import { ThemeProvider } from "@/app/theme-provider";
import { getRequestLocale, getRequestTheme } from "@/lib/request-locale";

import "./globals.css";

const SITE_URL = "https://diff.hoshinoshion.com";

const metadataByLocale = {
  en: {
    title: "Text Diff Tool",
    description:
      "Compare two texts side by side in your browser and highlight additions, deletions, and changes.",
    imageAlt: "Text Diff Tool comparing two texts side by side",
    openGraphLocale: "en_US",
  },
  "zh-CN": {
    title: "文本对比工具",
    description: "在浏览器中并排比较两份文本，高亮显示新增、删除和修改的内容。",
    imageAlt: "文本对比工具并排比较两份文本",
    openGraphLocale: "zh_CN",
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0e131b" },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const { title, description, imageAlt, openGraphLocale } =
    metadataByLocale[locale];
  const image = { url: "/og-image.png", width: 1200, height: 630, alt: imageAlt };

  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    applicationName: title,
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      url: "/",
      siteName: title,
      title,
      description,
      locale: openGraphLocale,
      alternateLocale: locale === "en" ? ["zh_CN"] : ["en_US"],
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
    icons: {
      icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
      shortcut: "/favicon.svg",
      apple: "/apple-touch-icon.png",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getRequestLocale();
  const theme = await getRequestTheme();
  const { title, description } = metadataByLocale[locale];
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: title,
    description,
    url: SITE_URL,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript",
    inLanguage: ["en", "zh-CN"],
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };

  return (
    <html lang={locale} data-theme={theme ?? undefined}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
          }}
        />
        <LocaleProvider initialLocale={locale}>
          <ThemeProvider initialTheme={theme}>{children}</ThemeProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
