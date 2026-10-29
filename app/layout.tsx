import type { Metadata, Viewport } from "next";

import { LocaleProvider } from "@/app/locale-provider";
import { ThemeProvider } from "@/app/theme-provider";
import { getRequestLocale, getRequestTheme } from "@/lib/request-locale";

import "./globals.css";

const SITE_URL = "https://diff.hoshinoshion.com";

const metadataByLocale = {
  en: {
    title: "Diff — Compare Two Texts",
    description:
      "Paste two versions of any text and see exactly what changed, line by line and word by word. Runs entirely in your browser.",
    imageAlt: "Two versions of a recipe compared side by side, with each changed word highlighted",
    openGraphLocale: "en_US",
  },
  "zh-CN": {
    title: "Diff · 文本对比",
    description:
      "粘贴两个版本的文本，逐行、逐词标出改动。全部在浏览器本地完成，内容不会上传。",
    imageAlt: "并排对比一份食谱的两个版本，每个改动的词都被高亮",
    openGraphLocale: "zh_CN",
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f2ea" },
    { media: "(prefers-color-scheme: dark)", color: "#13120f" },
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
