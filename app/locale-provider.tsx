"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { Locale } from "@/lib/locale";

const InitialLocaleContext = createContext<Locale>("en");

export function LocaleProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale: Locale;
}) {
  return (
    <InitialLocaleContext.Provider value={initialLocale}>
      {children}
    </InitialLocaleContext.Provider>
  );
}

export function useInitialLocale() {
  return useContext(InitialLocaleContext);
}
