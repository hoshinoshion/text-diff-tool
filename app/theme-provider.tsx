"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { Theme } from "@/lib/theme";

const InitialThemeContext = createContext<Theme | null>(null);

/** Shares the theme saved in the cookie, or null to follow the system. */
export function ThemeProvider({
  children,
  initialTheme,
}: {
  children: ReactNode;
  initialTheme: Theme | null;
}) {
  return (
    <InitialThemeContext.Provider value={initialTheme}>
      {children}
    </InitialThemeContext.Provider>
  );
}

export function useInitialTheme() {
  return useContext(InitialThemeContext);
}
