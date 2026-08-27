export type Locale = "en" | "zh-CN";

export const LANGUAGE_COOKIE_KEY = "text-diff-tool-language";
export const LANGUAGE_STORAGE_KEY = "text-diff-tool-language";

export function isLocale(value: string | null | undefined): value is Locale {
  return value === "en" || value === "zh-CN";
}

export function localeFromAcceptLanguage(value: string | null): Locale {
  const primaryLanguage = value?.split(",", 1)[0]?.split(";", 1)[0]?.trim();
  return primaryLanguage?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}
