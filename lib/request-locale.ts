import { cookies, headers } from "next/headers";
import { cache } from "react";

import {
  isLocale,
  LANGUAGE_COOKIE_KEY,
  localeFromAcceptLanguage,
  type Locale,
} from "@/lib/locale";
import { isTheme, THEME_COOKIE_KEY, type Theme } from "@/lib/theme";

export const getRequestLocale = cache(async (): Promise<Locale> => {
  const cookieLocale = (await cookies()).get(LANGUAGE_COOKIE_KEY)?.value;
  if (isLocale(cookieLocale)) return cookieLocale;

  return localeFromAcceptLanguage((await headers()).get("accept-language"));
});

/** The theme the visitor picked, or null to follow the system setting. */
export const getRequestTheme = cache(async (): Promise<Theme | null> => {
  const cookieTheme = (await cookies()).get(THEME_COOKIE_KEY)?.value;
  return isTheme(cookieTheme) ? cookieTheme : null;
});
