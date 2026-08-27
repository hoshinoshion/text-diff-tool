import { cookies, headers } from "next/headers";
import { cache } from "react";

import {
  isLocale,
  LANGUAGE_COOKIE_KEY,
  localeFromAcceptLanguage,
  type Locale,
} from "@/lib/locale";

export const getRequestLocale = cache(async (): Promise<Locale> => {
  const cookieLocale = (await cookies()).get(LANGUAGE_COOKIE_KEY)?.value;
  if (isLocale(cookieLocale)) return cookieLocale;

  return localeFromAcceptLanguage((await headers()).get("accept-language"));
});
